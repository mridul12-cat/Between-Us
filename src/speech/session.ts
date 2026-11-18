import type { CaptionEvent, CaptionSink, Language } from '../captions/contracts.js';
import type { SpeechOptions, SpeechProgress, SpeechResult } from './contracts.js';
import { MicrophoneCapture, microphoneError } from './microphone.js';
import { WhisperAdapter } from './whisper-adapter.js';
export interface SpeechRecognizer {
  ready:boolean;backend?:'wasm'|'webgpu';metrics?:{initMs:number;downloadedBytes:number};
  load(options:SpeechOptions):Promise<void>;
  recognize(audio:Float32Array,rate:number,options:SpeechOptions,session:number):Promise<SpeechResult>;
  dispose():void;
}
export interface CaptureDevice {active:boolean;start(onSegment:(audio:Float32Array,rate:number)=>void,onSilence:()=>void,onError:(message:string)=>void):Promise<void>;stop():void}
interface Segment {audio:Float32Array;rate:number;speakerId?:string;session:number;options:SpeechOptions;sequence:number;input:'microphone'|'recorded-sample'}
export function speechEvent(result:SpeechResult,session:number,sequence:number,speakerId?:string,input:'microphone'|'recorded-sample'='microphone'):CaptionEvent|undefined {
  const text=result.text.trim();if(!text)return undefined;
  return {id:`local-speech-${session}-${sequence}`,modality:'speech',originalText:result.task==='transcribe'?text:'',displayText:text,
    sourceLanguage:result.sourceLanguage,targetLanguage:result.targetLanguage,speakerId,timestamp:Date.now(),status:'final',provenance:'model-output',
    inference:{runtime:'local-whisper',task:result.task,input,backend:result.backend,association:speakerId?'manual':'neutral'}};
}
/** One inference + one pending segment. Session invalidation prevents late output after Stop. */
export class SpeechSession {
  readonly options:SpeechOptions={model:'base',backend:'wasm',language:'auto',output:'english'};
  readonly recognizer:SpeechRecognizer;
  private readonly capture:CaptureDevice;
  private generation=0;
  private sequence=0;
  private pending?:Segment;
  private running=false;
  private workerEpoch=0;
  private loading=false;
  private starting=false;
  private isLive=false;
  private lastText='';
  private lastTextTime=0;
  state:SpeechProgress={state:'unloaded',message:'Model not loaded'};
  lastResult?:SpeechResult;
  processingSpeaker?:string;
  droppedSegments=0;
  constructor(private readonly sink:CaptionSink,private readonly onState:()=>void,private readonly speaker:()=>string|undefined,
    recognizer?:SpeechRecognizer,capture?:CaptureDevice) {
    this.recognizer=recognizer??new WhisperAdapter(p=>{this.state=p;this.onState();});this.capture=capture??new MicrophoneCapture();
  }
  get active():boolean{return this.capture.active||this.starting;}
  get recording():boolean{return this.capture.active;}
  get live():boolean{return this.isLive;}
  get busy():boolean{return this.running||this.loading;}
  private status(state:SpeechProgress['state'],message:string):void{this.state={...this.state,state,message};this.onState();}
  setMode(live:boolean):void{this.stop();this.isLive=live;this.lastText='';this.status(this.recognizer.ready?'ready':'unloaded',this.recognizer.ready?'Ready':'Model not loaded');}
  async load():Promise<void>{
    if(this.loading||this.running)return;this.stop();this.loading=true;const generation=this.generation, epoch=this.workerEpoch;this.status('initializing','Initializing local speech model');
    try{await this.recognizer.load(this.options);if(generation===this.generation)this.status('ready','Ready');}
    catch(error){if(generation===this.generation)this.status('error',microphoneError(error));}
    finally{if(epoch===this.workerEpoch){this.loading=false;this.onState();}}
  }
  unload():void{this.workerEpoch++;this.stop();this.recognizer.dispose();this.loading=false;this.running=false;this.status('unloaded','Model not loaded');}
  configure(patch:Partial<SpeechOptions>):void {
    this.stop();const reload=patch.model!==undefined||patch.backend!==undefined;
    Object.assign(this.options,patch);
    if(reload){this.workerEpoch++;this.recognizer.dispose();this.loading=false;this.running=false;this.status('unloaded','Model changed. Select Load Model.');}
    else this.status(this.recognizer.ready?'ready':'unloaded',this.recognizer.ready?'Ready. Select Start Listening.':'Model not loaded');
  }
  async start():Promise<void> {
    if(!this.isLive||this.active||this.loading||this.running)return;
    if(!this.recognizer.ready){this.status('unloaded','Load the model in Settings before listening.');return;}
    const generation=++this.generation;this.starting=true;this.status('ready','Requesting microphone permission');
    try{
      await this.capture.start((audio,rate)=>this.enqueue(audio,rate,generation),()=>{if(generation===this.generation&&!this.running)this.status('empty','No speech detected. Listening...');},message=>{this.stop();this.status('error',message);});
      if(generation!==this.generation){this.capture.stop();return;}this.status('listening','Listening. Audio stays on this device.');
    }catch(error){if(generation===this.generation)this.status('error',microphoneError(error));}
    finally{if(generation===this.generation){this.starting=false;this.onState();}}
  }
  stop():void {
    ++this.generation;this.capture.stop();this.starting=false;this.pending=undefined;
    this.lastText='';this.lastTextTime=0;
    this.status(this.recognizer.ready?'ready':'unloaded',this.running?'Stopped. Discarding the in-progress result.':this.recognizer.ready?'Ready. Microphone off.':'Model not loaded');
  }
  private enqueue(audio:Float32Array,rate:number,session:number):void {
    if(!this.isLive||session!==this.generation)return;
    const segment:Segment={audio,rate,speakerId:this.speaker(),session,options:{...this.options},sequence:++this.sequence,input:'microphone'};
    if(this.running){if(this.pending){++this.droppedSegments;this.status('processing','Processing speech. Speak in short turns.');return;}this.pending=segment;return;}
    void this.process(segment);
  }
  /** Diagnostic fixture path uses the same local worker and caption event path, without microphone claims. */
  async recognizeFixture(audio:Float32Array,rate:number):Promise<SpeechResult|undefined> {
    if(!this.isLive||this.active||this.busy)throw Error('Use Live mode with the microphone stopped and a loaded model.');
    const segment={audio,rate,speakerId:this.speaker(),session:this.generation,options:{...this.options},sequence:++this.sequence,input:'recorded-sample' as const};
    this.lastResult=undefined;await this.process(segment);return segment.session===this.generation?this.lastResult:undefined;
  }
  private async process(segment:Segment):Promise<void> {
    const epoch=this.workerEpoch;
    this.running=true;this.processingSpeaker=segment.speakerId;this.status('processing',segment.input==='recorded-sample'?'Processing recorded speech locally':'Processing speech locally');
    try {
      const result=await this.recognizer.recognize(segment.audio,segment.rate,segment.options,segment.session);
      if(!this.isLive||segment.session!==this.generation)return;
      this.lastResult=result;const duplicateKey=`${segment.speakerId??'neutral'}:${result.sourceLanguage}:${result.targetLanguage}:${result.text.trim()}`;const event=speechEvent(result,segment.session,segment.sequence,segment.speakerId,segment.input);
      if(!event)this.status('empty','No speech detected.');
      else if(duplicateKey!==this.lastText||Date.now()-this.lastTextTime>12000){
        this.sink.receive(event);this.lastText=duplicateKey;this.lastTextTime=Date.now();this.status('caption','Caption available');
      }else this.status('caption','Repeated caption suppressed.');
    }catch(error){if(segment.session===this.generation){this.capture.stop();this.pending=undefined;this.status('error',microphoneError(error));}}
    finally{
      if(epoch===this.workerEpoch){
        this.running=false;
        this.processingSpeaker=undefined;
        const next=this.pending;this.pending=undefined;
        if(next&&next.session===this.generation&&this.isLive)void this.process(next);
        else this.onState();
      }
    }
  }
  dispose():void{this.stop();this.recognizer.dispose();}
}
