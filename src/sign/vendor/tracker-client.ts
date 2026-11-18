/** Page-side handle on the MediaPipe worker: feeds camera frames, one in flight at a time. */
import type { FeatureSet } from './features';
import type { TrackedFrame } from './recognizer';
import type { Delegate } from './tracker-core';
import type { TrackerWorkerIn, TrackerWorkerOut } from './tracker-protocol';

export interface TrackerFrame extends TrackedFrame {
  ms: number;
}

export class TrackerClient {
  private running = false;
  private busy = false;
  private onError: ((message:string)=>void) | null = null;
  private callbackId?:number;
  private video?:HTMLVideoElement;
  private generation=0;
  private onFrame: ((frame: TrackerFrame) => void) | null = null;

  private constructor(
    private readonly worker: Worker,
    readonly delegate: Delegate,
  ) {
    worker.onmessage = (event: MessageEvent<TrackerWorkerOut>) => {
      const msg = event.data;
      if (msg.type === 'landmarks') {
        this.busy = false;
        if (this.running)
          this.onFrame?.({ frame: msg.frame, t: msg.t, poses: msg.poses, ms: msg.ms });
      } else if (msg.type === 'frame-error') {
        this.busy = false;
        if(this.running)this.onError?.(msg.message);
      }
    };
    worker.onerror=event=>{if(this.running)this.onError?.(event.message||'Landmark worker failed.');};
  }

  static async create(featureSet: FeatureSet, signal?:AbortSignal): Promise<TrackerClient> {
    const worker = new Worker(new URL('./tracker.worker.ts', import.meta.url), { type: 'module' });
    const abort=()=>worker.terminate();
    signal?.addEventListener('abort',abort,{once:true});
    let timer:ReturnType<typeof setTimeout>;
    const reply = await new Promise<TrackerWorkerOut>((resolve, reject) => {
      signal?.addEventListener('abort',()=>reject(new DOMException('Tracker load cancelled','AbortError')),{once:true});
      timer=setTimeout(()=>reject(new Error('Landmark initialization timed out. Retry Start Signing.')),60000);
      worker.onmessage = (event: MessageEvent<TrackerWorkerOut>) => {
        resolve(event.data);
      };
      worker.onerror = (event) => {
        reject(new Error(event.message || 'the landmark worker failed to start'));
      };
      const msg: TrackerWorkerIn = { type: 'init', featureSet, delegate: 'CPU' };
      worker.postMessage(msg);
    }).catch((error: unknown) => {
      worker.terminate();clearTimeout(timer!);signal?.removeEventListener('abort',abort);
      throw error;
    });
    clearTimeout(timer!);signal?.removeEventListener('abort',abort);
    if (reply.type !== 'ready') {
      worker.terminate();
      throw new Error(reply.type === 'init-error' ? reply.message : 'unexpected reply');
    }
    return new TrackerClient(worker, reply.delegate);
  }

  /** Track `video` until stop(); frames that arrive while one is being processed are skipped. */
  start(video: HTMLVideoElement, onFrame: (frame: TrackerFrame) => void, onError?: (message:string)=>void): void {
    this.stop();const generation=this.generation;this.video=video;this.onError=onError??null;
    this.onFrame = onFrame;
    this.running = true;
    let lastMediaTime = -1;
    let lastTimestamp = -1;
    const hasVideoCallback = typeof video.requestVideoFrameCallback === 'function';
    const tick = (now: number, metadata?: VideoFrameCallbackMetadata) => {
      if (!this.running||generation!==this.generation) return;
      const mediaTime = metadata?.mediaTime ?? video.currentTime;
      const t = metadata?.presentationTime ?? now;
      if (!this.busy && video.readyState >= 2 && video.videoWidth > 0
          && mediaTime > lastMediaTime && t > lastTimestamp) {
        this.busy = true;
        lastMediaTime = mediaTime;
        lastTimestamp = t;
        createImageBitmap(video)
          .then((bitmap) => {
            if(!this.running||generation!==this.generation){bitmap.close();return;}
            const msg: TrackerWorkerIn = { type: 'frame', bitmap, t };
            this.worker.postMessage(msg, [bitmap]);
          })
          .catch((error:unknown) => {
            this.busy = false;
            if(this.running&&generation===this.generation)this.onError?.(error instanceof Error?error.message:'Camera frame transfer failed.');
          });
      }
      schedule();
    };
    const schedule = () => {
      if (hasVideoCallback) this.callbackId = video.requestVideoFrameCallback(tick);
      else this.callbackId = requestAnimationFrame(tick);
    };
    schedule();
  }

  stop(): void {
    ++this.generation;this.running = false;this.busy=false;
    if(this.callbackId!==undefined){if(this.video?.cancelVideoFrameCallback)this.video.cancelVideoFrameCallback(this.callbackId);else cancelAnimationFrame(this.callbackId);}
    this.callbackId=undefined;this.video=undefined;this.onError=null;this.onFrame = null;
  }

  dispose(): void {
    this.stop();
    this.worker.terminate();
  }
}
