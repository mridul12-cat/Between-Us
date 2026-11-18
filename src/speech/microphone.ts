import captureURL from './capture.worklet.ts?worker&url';
import { AudioSegmenter } from './audio.js';
export class MicrophoneCapture {
  private stream?:MediaStream;
  private context?:AudioContext;
  private node?:AudioWorkletNode;
  private source?:MediaStreamAudioSourceNode;
  private mute?:GainNode;
  private segmenter?:AudioSegmenter;
  private generation=0;
  active=false;
  async start(onSegment:(audio:Float32Array,sampleRate:number)=>void,onSilence:()=>void,onError:(message:string)=>void):Promise<void> {
    this.stop();const generation=++this.generation;
    if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Microphone access requires a supported browser on HTTPS or localhost.');
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
    if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());throw new DOMException('Listening was cancelled.','AbortError');}
    this.stream=stream;
    let context:AudioContext|undefined;
    try {
      context=new AudioContext();this.context=context;
      if(!context.audioWorklet)throw Error('This browser does not support the required audio capture pipeline.');
      await context.audioWorklet.addModule(captureURL);
      if(generation!==this.generation)throw new DOMException('Listening was cancelled.','AbortError');
      this.segmenter=new AudioSegmenter(context.sampleRate,onSegment,onSilence);
      this.node=new AudioWorkletNode(context,'between-us-capture');
      this.node.port.onmessage=(e:MessageEvent<Float32Array>)=>{if(this.active&&generation===this.generation)this.segmenter?.push(e.data);};
      this.source=context.createMediaStreamSource(stream);this.mute=context.createGain();this.mute.gain.value=0;
      this.source.connect(this.node).connect(this.mute).connect(context.destination);
      this.node.onprocessorerror=()=>{this.stop();onError('Audio capture stopped unexpectedly. Select Start Listening to retry.');};
      for(const track of stream.getAudioTracks())track.onended=()=>{this.stop();onError('The microphone disconnected. Reconnect it and try again.');};
      await context.resume();
      if(generation!==this.generation)throw new DOMException('Listening was cancelled.','AbortError');
      this.active=true;
    } catch(error){if(generation===this.generation)this.stop();else{stream.getTracks().forEach(t=>t.stop());void context?.close().catch(()=>{});}throw error;}
  }
  stop():void {
    ++this.generation;this.active=false;
    this.segmenter?.clear();this.segmenter=undefined;
    this.node?.port.close();this.node?.disconnect();this.node=undefined;
    this.source?.disconnect();this.source=undefined;this.mute?.disconnect();this.mute=undefined;
    if(this.stream)for(const t of this.stream.getTracks()){t.onended=null;t.stop();}this.stream=undefined;
    if(this.context){void this.context.close().catch(()=>{});this.context=undefined;}
  }
}
export function microphoneError(error:unknown):string {
  const name=error instanceof Error?error.name:'';
  if(name==='NotAllowedError'&&error instanceof Error&&/denied by system/i.test(error.message))return 'The operating system denied microphone access. Allow this browser in system privacy settings, then retry.';
  if(name==='NotAllowedError'||name==='SecurityError')return 'Microphone permission was denied. Allow it in browser site settings, then retry.';
  if(name==='NotFoundError')return 'No microphone was found. Connect a microphone and try again.';
  if(name==='NotReadableError')return 'The microphone is busy or unavailable. Close other recording apps and retry.';
  return error instanceof Error?error.message:'Unable to start the microphone.';
}
