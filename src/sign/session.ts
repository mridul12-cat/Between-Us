import type { CaptionEvent, CaptionSink } from '../captions/contracts.js';
import { CameraInput, cameraError } from './camera.js';
import { ModelClient, type LoadedModel } from './vendor/model-client';
import { TrackerClient } from './vendor/tracker-client';
import { Recognizer, type RecognizerEvent, type TrackedFrame } from './vendor/recognizer';
import { loadReplayClips } from './vendor/clips';
import { MAX_SAMPLE_GAP_MS, REVIEW_REST_MS, signDiagnosticsLines, visibility, type SignDiagnostics } from './live-quality';
import { DEFAULT_SEGMENTER, handSpeed } from './vendor/segmenter';
import type { TrackerFrame } from './vendor/tracker-client';

export type SignState='off'|'starting'|'looking'|'signing'|'recognizing'|'recognized'|'not-sure'|'unavailable';
export interface Candidate {label:string;index:number;score:number}
export interface SignPrediction {candidates:Candidate[];uncertain:boolean;reason?:string;speakerId?:string;input:'webcam'|'reference-replay';modelVersion:string;inferenceMs:number;frames:number}
/** Future text translation seam. No unsupported Hindi/Spanish output is manufactured. */
export interface SignLabelTranslator {translate(label:string,target:'en'|'hi'|'es'):Promise<string>}
export const englishSignLabels:SignLabelTranslator={async translate(label,target){if(target!=='en')throw Error('Sign display currently supports English only.');return label;}};
export function signEvent(p:SignPrediction,index:number,confirmed:boolean,id:string):CaptionEvent|undefined {
  const c=p.candidates[index];if(!c)return;
  return {id,modality:'sign',originalText:c.label,displayText:c.label,sourceLanguage:'ase',targetLanguage:'en',speakerId:p.speakerId,timestamp:Date.now(),status:p.uncertain?'uncertain':'final',provenance:'model-output',
    inference:{runtime:'local-gesturesign',task:'isolated-sign',backend:'wasm',association:p.speakerId?'manual':'neutral',modelVersion:p.modelVersion,input:p.input,confirmed,score:c.score}};
}
/** Owns one camera, one Holistic worker and one classifier worker. Stop invalidates every async path. */
export class SignSession {
  state:SignState='off';message='Camera off. Select Start Signing.';
  active=false;autoDisplay=false;selected=0;pending?:SignPrediction;last?:SignPrediction;
  cameras:MediaDeviceInfo[]=[];deviceId?:string;
  readonly camera=new CameraInput();
  metrics={initMs:0,frames:0,landmarkMs:0,firstFrameAt:0,lastFrameAt:0,inferences:0,inferenceMs:0,delegate:''};
  private watchdog?:ReturnType<typeof setInterval>;
  private model?:LoadedModel;private tracker?:TrackerClient;private recognizer?:Recognizer;
  private abort?:AbortController;private generation=0;private sequence=0;private enabled=false;private busy=false;
  private segmentSpeaker?:string;private input:SignPrediction['input']='webcam';
  private lastAuto='';private lastAutoAt=0;
  private readonly devicesChanged=()=>{void this.listCameras();};
  constructor(private readonly sink:CaptionSink,private readonly changed:()=>void,private readonly speaker:()=>string|undefined){navigator.mediaDevices?.addEventListener('devicechange',this.devicesChanged);}
  private referenceRequiresConfirmation=false;
  private shared = false;
  private readonly reviewRest: { required: boolean; since?: number; previous?: TrackedFrame } = { required: false };
  private diagnostics: Omit<SignDiagnostics, 'segmentation' | 'collected'> = {};
  private lastDiagnosticUpdate = 0;

  diagnosticLines(): string[] { return signDiagnosticsLines(this.diagnosticSnapshot()); }

  private diagnosticSnapshot(): SignDiagnostics {
    let segmentation: string = this.state;
    if (this.pending) segmentation = 'awaiting review';
    else if (this.state === 'looking' || this.state === 'signing') {
      segmentation = this.reviewRest.required ? 'waiting for rest' : this.recognizer?.segmentation ?? 'idle';
    }
    return { ...this.diagnostics, segmentation, collected: this.recognizer?.collected ?? 0 };
  }

  private requireRest(): void {
    this.reviewRest.required = true;
    this.reviewRest.previous = undefined;
    this.reviewRest.since = undefined;
  }

  private readyForMotion(frame: TrackedFrame, seen: ReturnType<typeof visibility>): boolean {
    const rest = this.reviewRest;
    if (!rest.required) return true;
    const previous = rest.previous;
    const consecutive = previous && frame.t > previous.t && frame.t - previous.t <= MAX_SAMPLE_GAP_MS;
    const still = !seen.left && !seen.right || consecutive && handSpeed(previous, frame) < DEFAULT_SEGMENTER.moveSpeed;
    rest.previous = frame;
    if (!consecutive || !still) rest.since = undefined;
    if (!still) return false;
    rest.since ??= frame.t;
    if (this.pending || this.busy || frame.t - rest.since < REVIEW_REST_MS) return false;
    rest.required = false;
    rest.previous = undefined;
    this.status('looking', 'No sign detected. Sign one word, then hold still.');
    return true;
  }

  private trackFrame(frame: TrackerFrame, eligible = true): void {
    this.metrics.frames++;
    this.metrics.landmarkMs += (frame.ms - this.metrics.landmarkMs) / this.metrics.frames;
    this.metrics.firstFrameAt ||= frame.t;
    this.metrics.lastFrameAt = frame.t;
    this.diagnostics.visible = visibility(frame.frame);
    if (eligible && this.recognizer && this.readyForMotion(frame, this.diagnostics.visible) && !this.pending && !this.busy) {
      this.recognizer.push(frame);
    }
    if (frame.t - this.lastDiagnosticUpdate >= 250) {
      this.lastDiagnosticUpdate = frame.t;
      this.changed();
    }
  }

  /** Camera AR owns capture and the Holistic worker. Only initialize the classifier here. */
  async startShared(): Promise<void> {
    if (!this.enabled || this.active) return;
    this.stop();
    this.shared = true;
    this.active = true;
    this.input = 'webcam';
    this.metrics = {initMs:0,frames:0,landmarkMs:0,firstFrameAt:0,lastFrameAt:0,inferences:0,inferenceMs:0,delegate:''};
    const generation = this.generation;
    this.status('starting','Preparing on-device sign recognition…');
    try {
      if (await this.load(generation)) this.status('looking','No sign detected. Sign one word, then hold still.');
    } catch (error) {
      if (generation===this.generation) this.fail(cameraError(error));
    }
  }

  pushShared(frame: TrackerFrame, eligible: boolean): void {
    if (this.shared && this.active) this.trackFrame(frame, eligible);
  }

  interruptShared(): void {
    if (!this.shared || !this.recognizer) return;
    const changed = this.pending || ['recognized','signing','recognizing','not-sure'].includes(this.state);
    this.recognizer.reset();
    this.requireRest();
    this.pending = undefined;
    if (changed) this.status('looking','No sign detected. Tracking interrupted. Hold still and try again.');
  }

  private status(state:SignState,message:string):void{this.state=state;this.message=message;this.changed();}
  setEnabled(enabled:boolean):void{this.stop();this.enabled=enabled;if(enabled)void this.listCameras();}
  async listCameras():Promise<void>{try{this.cameras=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');this.changed();}catch{/* Start provides the actionable error. */}}
  cycleCamera():void{this.stop();const i=this.cameras.findIndex(d=>d.deviceId===this.deviceId);this.deviceId=this.cameras[(i+1)%this.cameras.length]?.deviceId;this.changed();}
  private async load(generation:number):Promise<boolean>{
    const started=performance.now();this.abort=new AbortController();
    const model=await ModelClient.load(this.abort.signal);
    if(generation!==this.generation){model.client.dispose();return false;}this.model=model;
    this.metrics.initMs=performance.now()-started;
    this.recognizer=new Recognizer(model.meta,model.labels,async input=>{
      if(this.busy)throw Error('Classifier busy. Please sign one word at a time.');
      this.busy=true;if(this.input==='webcam')this.requireRest();this.status('recognizing','Recognizing on this device');
      try{const result=await model.client.infer(input);if(generation===this.generation){this.metrics.inferenceMs=result.ms;this.metrics.inferences++;}return result;}finally{if(generation===this.generation)this.busy=false;}
    },event=>{if(generation===this.generation)this.event(event);}, this.input==='webcam');return true;
  }
  async start():Promise<void>{
    if(!this.enabled||this.active)return;this.stop();const generation=this.generation;this.active=true;this.input='webcam';
    this.metrics={initMs:0,frames:0,landmarkMs:0,firstFrameAt:0,lastFrameAt:0,inferences:0,inferenceMs:0,delegate:''};
    this.status('starting','Requesting camera permission. Camera stays local.');
    try{
      await this.camera.start(this.deviceId,()=>{if(generation===this.generation)this.fail('Camera disconnected. Reconnect and select Start Signing.');});
      if(generation!==this.generation)return;
      void this.listCameras();this.changed();this.status('starting','Camera ready. Preparing on-device recognition.');
      const started=performance.now();if(!await this.load(generation))return;
      const tracker=await TrackerClient.create(this.model!.meta.featureSet,this.abort!.signal);
      if(generation!==this.generation){tracker.dispose();return;}this.tracker=tracker;this.metrics.delegate=tracker.delegate;this.metrics.initMs=performance.now()-started;
      this.status('starting','Camera ready. Starting landmark detection.');
      const trackingStarted=performance.now();
      this.watchdog=setInterval(()=>{if(generation===this.generation&&performance.now()-(this.metrics.lastFrameAt||trackingStarted)>(this.metrics.frames?10000:60000))this.fail('Camera frames stopped arriving. Check the camera and retry.');},1000);
      tracker.start(this.camera.video,frame=>{
        if(generation!==this.generation)return;
        this.trackFrame(frame);
      },message=>{if(generation===this.generation)this.fail(`Landmark processing unavailable: ${message}`);});
    }catch(error){if(generation===this.generation)this.fail(cameraError(error));}
  }
  private event(event:RecognizerEvent):void {
    if(event.type==='status'){
      if(this.pending||this.busy||this.recognizer?.segmentation==='signing')return;
      const text = {
        nothing: 'No person in view.',
        'no-hands': 'Bring your signing hand into view.',
        crowded: 'Frame one signer at a time.',
        partial: 'Keep your face, shoulders and signing hand in view.',
        ok: 'Sign one word, then hold still.',
      }[event.status];
      this.status('looking', 'No sign detected. ' + text);
    }else if(event.type==='signing'){
      this.segmentSpeaker=this.speaker();
      this.diagnostics.confidence=undefined;
      this.status('signing','Collecting sign motion…');
    } else if(event.type==='discarded'){
      this.diagnostics.lastSegment={frames:event.frames??0,fps:event.fps??0,reason:event.reason};
      this.status('looking','No sign detected. Try one complete sign, then hold still.');
    }
    else if(event.type==='error')this.fail(event.message);
    else if(event.type==='result'){
      const r=event.result;
      this.diagnostics.lastSegment={frames:r.segment.frames.length,fps:r.segment.fps,reason:r.decision.reason??r.endReason};
      const [first, second]=r.decision.top;
      this.diagnostics.confidence=first ? {score:first.probability, margin:first.probability-(second?.probability??0)} : undefined;
      if(!first){this.status('not-sure','Not sure. No valid classifier result.');return;}
      const p:SignPrediction={candidates:r.decision.top.map(g=>({label:this.model!.labels[g.index].label,index:g.index,score:g.probability})),uncertain:r.decision.kind!=='sign',reason:r.decision.reason,speakerId:this.segmentSpeaker,input:this.input,modelVersion:this.model!.meta.version,inferenceMs:this.metrics.inferenceMs,frames:r.segment.frames.length};
      this.last=p;this.pending=p;this.selected=0;
      this.status(p.uncertain?'not-sure':'recognized',p.uncertain?'Not sure. Confirm only if a candidate is correct.':`Recognized: ${p.candidates[0].label}. Confirm to share.`);
      if(this.autoDisplay&&!p.uncertain&&!this.referenceRequiresConfirmation)this.confirm(false);
    }
  }
  choose(index:number):void{if(this.pending?.candidates[index]){this.selected=index;this.changed();}}
  confirm(manual=true):boolean {
    if(!this.enabled||!this.pending)return false;
    const p=this.pending,c=p.candidates[this.selected];
    if(!manual&&(p.uncertain||!c))return false;
    const duplicate=!manual&&this.lastAuto===c.label&&Date.now()-this.lastAutoAt<4000;
    const event=signEvent(p,this.selected,manual,`local-sign-${this.generation}-${++this.sequence}`);
    const accepted=!!event&&!duplicate&&this.sink.receive(event);
    if(!manual&&accepted){this.lastAuto=c.label;this.lastAutoAt=Date.now();}
    this.pending=undefined;
    if(this.input==='reference-replay')this.recognizer?.reset();
    this.status('looking',accepted?`${manual?'Confirmed':'Shared'}: ${c.label}${p.input==='reference-replay'?' | reference clip':' | Ready for another sign'}.`:'No sign detected. Ready for another sign.');return accepted;
  }
  dismiss(): void {
    this.pending = undefined;
    this.recognizer?.reset();
    if (this.active) this.requireRest();
    this.status(this.active ? 'looking' : 'off', this.active ? 'No sign detected. Hold still, then try another sign.' : 'Dismissed. Camera off.');
  }
  toggleAuto():void{this.autoDisplay=!this.autoDisplay;this.dismiss();}
  private fail(message:string):void{this.stop();this.status('unavailable',`Recognition unavailable. ${message}`);}
  stop():void{
    ++this.generation;clearInterval(this.watchdog);this.watchdog=undefined;this.abort?.abort();this.abort=undefined;this.camera.stop();this.tracker?.dispose();this.tracker=undefined;
    this.recognizer?.reset();this.recognizer=undefined;this.model?.client.dispose();this.model=undefined;
    this.reviewRest.required=false;this.reviewRest.previous=undefined;this.reviewRest.since=undefined;
    this.diagnostics={};this.lastDiagnosticUpdate=0;
    this.pending=undefined;this.shared=false;this.referenceRequiresConfirmation=false;this.active=false;this.busy=false;this.lastAuto='';this.status('off','Camera off. Select Start Signing.');
  }
  /** Authorized upstream held-out landmarks, real ONNX and segmentation. Explicit diagnostic, no webcam claim. */
  async replay(index:number, requireConfirmation=false):Promise<SignPrediction|undefined>{
    if(!this.enabled||this.active)throw Error('Select Sign mode and stop the camera before a reference replay.');
    this.stop();const generation=this.generation;this.input='reference-replay';this.referenceRequiresConfirmation=requireConfirmation;this.status('starting','Reference replay: loading genuine local model. Camera off.');
    try{
      if(!await this.load(generation))return;
      const clips=await loadReplayClips();
      if(generation!==this.generation)return;
      const clip=clips[index];if(!clip)throw Error('Unknown reference clip.');
      this.last=undefined;
      for(let i=0;i<clip.frames.length&&!this.busy&&!this.pending;i++)this.recognizer!.push({frame:clip.frames[i],t:i*1000/clip.fps,poses:1});
      if(!this.busy)this.recognizer!.flush();
      const started=performance.now();
      while(generation===this.generation&&!this.last&&this.state!=='unavailable'&&performance.now()-started<15000)await new Promise(r=>setTimeout(r,20));
      if(generation!==this.generation)return;
      if(!this.last&&this.state!=='unavailable')throw Error('Reference clip did not produce a complete sign.');
      return this.last;
    }catch(error){if(generation===this.generation)this.fail(cameraError(error));}
  }
  snapshot(){return {state:this.state,message:this.message,active:this.active,cameraOn:this.camera.active,autoDisplay:this.autoDisplay,selected:this.selected,pending:this.pending,last:this.last,metrics:{...this.metrics},diagnostics:this.diagnosticSnapshot(),cameraCount:this.cameras.length};}
  dispose():void{this.stop();navigator.mediaDevices?.removeEventListener('devicechange',this.devicesChanged);}
}
