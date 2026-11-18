/**
 * The live pipeline, independent of where frames come from (camera, Replay or
 * the e2e injection hook): frame status -> segmenter -> features -> model ->
 * decision. Inference is injected so the logic is unit-testable without
 * workers or WASM.
 */
import { MAX_SAMPLE_GAP_MS, reviewLiveDecision, segmentQuality } from '../live-quality';
import { decide, type Decision } from './decision';
import { modelInput, type ModelInput } from './features';
import type { Frame } from './landmarks';
import type { ModelMeta, SignLabel } from './meta';
import { Segmenter, frameStatus, type EndReason, type FrameStatus, type Segment } from './segmenter';

export interface Inference {
  logits: Float32Array;
  embedding: Float32Array;
}

export type Infer = (input: ModelInput) => Promise<Inference>;

export interface RecognitionResult {
  decision: Decision;
  inference: Inference;
  segment: Segment;
  endReason: EndReason;
  /** True when the signer's shoulders were out of view for most of the sign. */
  partial: boolean;
}

export type RecognizerEvent =
  | { type: 'status'; status: FrameStatus }
  | { type: 'signing' }
  | { type: 'discarded'; reason: string; frames?: number; fps?: number }
  | { type: 'result'; result: RecognitionResult }
  | { type: 'error'; message: string };

export interface TrackedFrame {
  frame: Frame;
  /** Milliseconds, monotonic. */
  t: number;
  /** People the pose landmarker found (0, 1 or more). */
  poses: number;
}

export class Recognizer {
  private readonly segmenter: Segmenter;
  private statuses: FrameStatus[] = [];
  private lastStatus: FrameStatus | null = null;
  private generation = 0;
  private lastTimestamp?: number;

  constructor(
    private readonly meta: ModelMeta,
    private readonly labels: readonly SignLabel[],
    private readonly infer: Infer,
    private readonly emit: (event: RecognizerEvent) => void,
    private readonly live = false,
  ) {
    // ONNX still requires at least minFrames after resampling to its own clock.
    // Five actual observations keep a brief sign eligible when Holistic runs at 15 fps.
    this.segmenter = new Segmenter(live ? { minFrames: 5 } : {});
  }

  get shipped(): boolean[] {
    return this.labels.map((l) => l.shipped);
  }

  get segmentation() { return this.segmenter.state; }
  get collected() { return this.segmenter.collected; }

  reset(): void {
    this.generation++;
    this.segmenter.reset();
    this.statuses = [];
    this.lastStatus = null;
    this.lastTimestamp = undefined;
  }

  push({ frame, t, poses }: TrackedFrame): void {
    if (this.live && this.lastTimestamp !== undefined) {
      const gap = t - this.lastTimestamp;
      if (gap <= 0) return;
      if (gap > MAX_SAMPLE_GAP_MS) {
        const frames = this.segmenter.collected;
        this.segmenter.reset();
        this.statuses = [];
        if (frames) this.emit({ type: 'discarded', reason: 'camera gap', frames });
      }
    }
    this.lastTimestamp = t;
    const status = frameStatus(frame, poses);
    if (this.live && status === 'crowded') {
      const frames = this.segmenter.collected;
      this.segmenter.reset();
      this.statuses = [];
      if (frames) this.emit({ type: 'discarded', reason: 'multiple people', frames });
    }
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.emit({ type: 'status', status });
    }
    const event = this.segmenter.push(frame, t, { crowded: status === 'crowded', resetOnHandLoss: this.live });
    if (this.segmenter.state === 'signing') this.statuses.push(status);
    this.handle(event);
  }

  /** End an open sign now, e.g. when a replay clip finishes. */
  flush(): void {
    this.handle(this.segmenter.flush());
  }

  private handle(event: ReturnType<Segmenter['push']>): void {
    if (!event) return;
    if (event.type === 'start') {
      this.statuses = [];
      this.emit({ type: 'signing' });
      return;
    }
    const statuses = this.statuses;
    this.statuses = [];
    if (event.type === 'discard') {
      this.emit({ type: 'discarded', reason: event.reason });
      return;
    }
    // Vote only over frames where the signer's hands were seen: frames without
    // hands (the gap that ends a sign, short dropouts) say nothing about framing.
    const partialFrames = statuses.filter((s) => s === 'partial').length;
    const framedFrames = partialFrames + statuses.filter((s) => s === 'ok').length;
    const partial = partialFrames > framedFrames / 2;
    const quality = this.live ? segmentQuality(event.segment) : undefined;
    if (this.live && event.reason === 'max') {
      this.emit({ type: 'discarded', reason: 'no pause before time limit', frames:event.segment.frames.length, fps:event.segment.fps });
      return;
    }
    if (quality?.incomplete) {
      this.emit({ type: 'discarded', reason: 'hands frequently untracked', frames:event.segment.frames.length, fps:event.segment.fps });
      return;
    }
    void this.classify(event.segment, event.reason, partial || !!quality?.partial, this.generation);
  }

  private async classify(segment: Segment, endReason: EndReason, partial: boolean, generation: number): Promise<void> {
    const input = modelInput(segment.frames, segment.fps, this.meta, this.live ? segment.timestamps : undefined);
    if (input.frames < this.meta.minFrames) {
      this.emit({ type: 'discarded', reason: 'too-short' });
      return;
    }
    try {
      const inference = await this.infer(input);
      if (generation !== this.generation) return; // the mode or source changed meanwhile
      const decision = decide(inference.logits, this.shipped, this.meta.calibration, { partial });
      this.emit({ type: 'result', result: { decision: this.live ? reviewLiveDecision(decision) : decision, inference, segment, endReason, partial } });
    } catch (error) {
      if(generation!==this.generation)return;
      this.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
}
