import type { SpeechOptions, SpeechProgress, SpeechResult, WorkerRequest, WorkerResponse } from './contracts.js';
interface Pending { resolve:(response:WorkerResponse)=>void; reject:(error:Error)=>void; timer:ReturnType<typeof setTimeout> }
export class WhisperAdapter {
  private worker?:Worker;
  private sequence=0;
  private readonly pending=new Map<number,Pending>();
  ready=false;
  backend:'wasm'|'webgpu'|undefined;
  metrics:{initMs:number;downloadedBytes:number}|undefined;
  constructor(private readonly onProgress:(progress:SpeechProgress)=>void){}
  private ensureWorker():Worker {
    if(!this.worker){
      this.worker=new Worker(new URL('./whisper.worker.ts',import.meta.url),{type:'module',name:'between-us-local-whisper'});
      this.worker.onmessage=(e:MessageEvent<WorkerResponse>)=>{
        const message=e.data;
        if(message.type==='progress'){if(this.pending.has(message.id))this.onProgress(message.progress);return;}
        const request=this.pending.get(message.id);if(!request)return;
        this.pending.delete(message.id);clearTimeout(request.timer);
        if(message.type==='error')request.reject(Error(message.message));else request.resolve(message);
      };
      this.worker.onerror=()=>{this.failAll(Error('The local speech worker stopped unexpectedly. Reload the model to retry.'));this.worker?.terminate();this.worker=undefined;};
    }
    return this.worker;
  }
  private request(message:WorkerRequest,transfer:Transferable[]=[],timeout=180000):Promise<WorkerResponse> {
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(message.id);reject(Error('Local speech processing took too long. Stop and retry with Tiny or another backend.'));this.dispose();},timeout);
      this.pending.set(message.id,{resolve,reject,timer});
      try{this.ensureWorker().postMessage(message,transfer);}catch(error){clearTimeout(timer);this.pending.delete(message.id);reject(error);}
    });
  }
  async load(options:SpeechOptions):Promise<void> {
    if(this.pending.size)throw Error('Stop the current operation before loading another model.');
    this.ready=false;this.onProgress({state:'initializing',message:'Starting local speech model'});
    const response=await this.request({type:'load',id:++this.sequence,model:options.model,backend:options.backend},[],300000);
    if(response.type!=='loaded')throw Error('Invalid model initialization response.');
    this.ready=true;this.backend=response.backend;this.metrics={initMs:response.initMs,downloadedBytes:response.downloadedBytes};
    this.onProgress({state:'ready',message:'Ready',backend:response.backend,...this.metrics});
  }
  async recognize(audio:Float32Array,sampleRate:number,options:SpeechOptions,session:number):Promise<SpeechResult> {
    if(!this.ready)throw Error('Load the speech model before listening.');
    const response=await this.request({type:'recognize',id:++this.sequence,session,audio,sampleRate,language:options.language,output:options.output},[audio.buffer as ArrayBuffer]);
    if(response.type!=='result'||response.session!==session)throw Error('Unexpected speech worker response.');
    this.backend=response.result.backend;return response.result;
  }
  private failAll(error:Error):void{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.ready=false;}
  dispose():void{this.failAll(new DOMException('Speech operation cancelled.','AbortError'));this.worker?.terminate();this.worker=undefined;this.backend=undefined;this.metrics=undefined;}
}
