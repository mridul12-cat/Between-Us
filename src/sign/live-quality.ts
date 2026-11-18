import type { Decision } from './vendor/decision';
import { LEFT_HAND_START, LIPS, RIGHT_HAND_START, type Frame } from './vendor/landmarks';
import { frameStatus, type Segment } from './vendor/segmenter';

// A stall this long is comparable to GestureSign's 300 ms end-of-sign gap.
export const MAX_SAMPLE_GAP_MS = 250;
export const REVIEW_REST_MS = 300;

function inView(frame: Frame, point: number): boolean {
  const x = frame[point * 3];
  const y = frame[point * 3 + 1];
  return x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

export function visibility(frame: Frame) {
  return {
    left: inView(frame, LEFT_HAND_START) || inView(frame, LEFT_HAND_START + 9),
    right: inView(frame, RIGHT_HAND_START) || inView(frame, RIGHT_HAND_START + 9),
    face: LIPS.filter(point => inView(frame, point)).length >= LIPS.length / 2,
  };
}

export function segmentQuality(segment: Segment) {
  let withHands = 0;
  let framed = 0;
  let tracked = 0;
  segment.frames.forEach(frame => {
    if (Number.isFinite(frame[LEFT_HAND_START * 3]) || Number.isFinite(frame[RIGHT_HAND_START * 3])) tracked++;
    const seen = visibility(frame);
    if (!seen.left && !seen.right) return;
    withHands++;
    if (seen.face && frameStatus(frame, 1) === 'ok') framed++;
  });
  return {
    incomplete: tracked < segment.frames.length * 0.6,
    partial: withHands < tracked / 2 || framed < withHands / 2,
  };
}

/** Extra review criteria for noisy live input. Leave stock logits and candidate ranking intact. */
export function reviewLiveDecision(decision: Decision): Decision {
  if (decision.kind !== 'sign') return decision;
  const [first, second] = decision.top;
  if (first.probability < 0.50) return { ...decision, kind: 'not-sure', reason: 'low-confidence' };
  if (first.probability - (second?.probability ?? 0) < 0.15) {
    return { ...decision, kind: 'not-sure', reason: 'close-alternatives' };
  }
  return decision;
}

export interface SignDiagnostics {
  visible?: ReturnType<typeof visibility>;
  segmentation: string;
  collected: number;
  lastSegment?: { frames: number; fps: number; reason: string };
  confidence?: { score: number; margin: number };
}

export function signDiagnosticsLines(data: SignDiagnostics): string[] {
  const seen = (part?: boolean) => part === undefined ? '-' : part ? 'seen' : 'missing';
  const { visible, segmentation, collected, lastSegment, confidence } = data;
  const percent = (score: number) => Math.round(score * 100) + '%';
  const last = lastSegment
    ? `Last: ${lastSegment.frames} frames at ${lastSegment.fps.toFixed(1)} fps (${lastSegment.reason})`
    : 'Last: -';
  return [
    `L hand: ${seen(visible?.left)} | R hand: ${seen(visible?.right)} | Face: ${seen(visible?.face)}`,
    `Segment: ${segmentation} | Collected: ${collected}`,
    last,
    `Model: ${confidence ? percent(confidence.score) + ' (gap ' + percent(confidence.margin) + ')' : '-'}`,
  ];
}
