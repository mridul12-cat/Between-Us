/** Explicit, in-memory browser camera. No recorder, upload or persisted frames. */
export class CameraInput {
  readonly video=document.createElement('video');
  private stream?:MediaStream;
  private ended?:()=>void;
  private generation=0;
  constructor(){this.video.muted=true;this.video.playsInline=true;}
  get active():boolean{return this.stream?.getVideoTracks().some(t=>t.readyState==='live')??false;}
  async start(deviceId:string|undefined,onEnded:()=>void):Promise<void>{
    this.stop();const generation=this.generation;
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access requires a secure HTTPS page and a supported browser.');
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:30},...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:'user'})}});
    if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());throw new DOMException('Camera request cancelled','AbortError');}
    this.stream=stream;this.ended=onEnded;this.video.srcObject=stream;
    stream.getVideoTracks().forEach(t=>t.addEventListener('ended',onEnded,{once:true}));
    try{
      await this.video.play();
      await new Promise<void>((resolve,reject)=>{
        const started=performance.now();
        const check=()=>{if(generation!==this.generation)reject(new DOMException('Camera stopped','AbortError'));else if(this.video.readyState>=2&&this.video.videoWidth>0)resolve();else if(performance.now()-started>10000)reject(Error('Camera opened but no frames arrived.'));else setTimeout(check,50);};check();
      });
    }catch(error){if(generation===this.generation)this.stop();throw error;}
  }
  stop():void{++this.generation;this.stream?.getTracks().forEach(t=>{if(this.ended)t.removeEventListener('ended',this.ended);t.stop();});this.ended=undefined;this.stream=undefined;this.video.pause();this.video.srcObject=null;}
}
export function cameraError(error:unknown):string {
  if(error instanceof DOMException){
    if(error.name==='NotAllowedError'){
      if(/by system/i.test(error.message))return 'Camera denied by macOS. Allow Camera for the app that opened this browser in Privacy & Security, then retry.';
      return 'Camera permission denied. Allow camera for this site in the browser, then retry.';
    }
    if(error.name==='NotFoundError')return 'No browser camera found. Connect a webcam and retry.';
    if(error.name==='NotReadableError')return 'Camera unavailable or in use. Close other camera apps and retry.';
    if(error.name==='OverconstrainedError')return 'Selected camera unavailable. Choose another camera.';
  }
  return error instanceof Error?error.message:String(error);
}
