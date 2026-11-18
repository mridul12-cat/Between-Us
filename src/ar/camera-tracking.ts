import { CameraInput, cameraError } from '../sign/camera';
import { TrackerClient, type TrackerFrame } from '../sign/vendor/tracker-client';
import { WebcamAnchors } from './person-anchor';

export class CameraTracking {
  readonly camera = new CameraInput();
  readonly anchors = new WebcamAnchors();
  state: 'off' | 'starting' | 'tracking' | 'error' = 'off';
  message = 'Camera off';
  lastError?: {name:string;message:string};
  frameCount = 0;
  lastFrame = 0;
  meanMs = 0;
  devices: MediaDeviceInfo[] = [];
  deviceId = '';
  private abort?: AbortController;
  private tracker?: TrackerClient;
  private watchdog?: ReturnType<typeof setInterval>;

  constructor(private readonly changed: () => void, private readonly onFrame: (frame: TrackerFrame) => void) {}

  async listDevices(): Promise<void> {
    try {
      this.devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind==='videoinput');
      this.changed();
    } catch { /* Start reports an actionable camera error. */ }
  }

  async start(): Promise<void> {
    if (this.abort) return;
    const abort = this.abort = new AbortController();
    this.lastError = undefined;
    this.frameCount = 0; this.lastFrame = 0; this.meanMs = 0;
    this.status('starting','Requesting camera permission…');
    try {
      await this.camera.start(this.deviceId || undefined, () => {
        if (!abort.signal.aborted) this.fail('Camera disconnected. Reconnect it, then start the camera.');
      });
      if (abort.signal.aborted) return;
      void this.listDevices();
      this.status('starting','Camera on · Starting person tracking…');
      const tracker = await TrackerClient.create('hands_pose_lips',abort.signal);
      if (abort.signal.aborted) { tracker.dispose(); return; }
      this.tracker = tracker;
      const started = performance.now();
      this.watchdog = setInterval(() => {
        if (performance.now()-(this.lastFrame||started) > (this.lastFrame ? 8000 : 30000)) {
          this.fail('Tracking stopped receiving frames. Restart the camera.');
        }
      },1000);
      tracker.start(this.camera.video, frame => {
        if (abort.signal.aborted) return;
        this.frameCount++;
        this.lastFrame = frame.t;
        this.meanMs += (frame.ms-this.meanMs)/this.frameCount;
        this.anchors.update(frame.frame,frame.poses,frame.t);
        this.onFrame(frame);
        if (this.frameCount === 1) this.status('tracking','Camera on · Person tracking active');
      }, error => { if (!abort.signal.aborted) this.fail('Frame processing failed. '+error); });
    } catch (error) {
      if (!abort.signal.aborted) {
        this.lastError = {name:error instanceof Error?error.name:'Error',message:error instanceof Error?error.message:String(error)};
        this.fail(cameraError(error));
      }
    }
  }

  stop(): void {
    this.abort?.abort();
    this.abort = undefined;
    this.tracker?.dispose();
    this.tracker = undefined;
    clearInterval(this.watchdog);
    this.watchdog = undefined;
    this.camera.stop();
    this.anchors.clear();
    this.status('off','Camera off');
  }

  private fail(message: string): void {
    this.stop();
    this.status('error',message);
  }

  private status(state: CameraTracking['state'], message: string): void {
    this.state=state;
    this.message=message;
    this.changed();
  }
}
