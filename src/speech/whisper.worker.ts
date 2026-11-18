/// <reference lib="webworker" />
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import wasmURL from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import moduleURL from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { resampleMono, rms, validateAudio } from './audio.js';
import { taskOptions, inferenceError, validateTranscript } from './config.js';
import type { WorkerRequest, WorkerResponse, SpeechBackend, SpeechModel } from './contracts.js';

env.allowLocalModels=false;env.useBrowserCache=true;env.useWasmCache=true;
env.backends.onnx.wasm!.numThreads=1;
env.backends.onnx.wasm!.proxy=false;
env.backends.onnx.wasm!.wasmPaths={wasm:wasmURL,mjs:moduleURL};
let transcriber:AutomaticSpeechRecognitionPipeline|undefined;
let model:SpeechModel='tiny',requestedBackend:SpeechBackend='auto',backend:'wasm'|'webgpu'='wasm';
let chain=Promise.resolve();
const send=(message:WorkerResponse)=>self.postMessage(message);
async function load(id:number,nextModel:SpeechModel,nextBackend:SpeechBackend,notify=true):Promise<void> {
  const started=performance.now();model=nextModel;requestedBackend=nextBackend;
  if(transcriber){await transcriber.dispose();transcriber=undefined;}
  const files=new Map<string,number>();
  let lastProgress=0;
  const progress_callback=(value:unknown)=>{
    const p=value as {status?:string;file?:string;loaded?:number;total?:number;progress?:number};
    if(p.file&&p.loaded!==undefined)files.set(p.file,p.loaded);
    const now=performance.now();if(now-lastProgress<150&&p.status!=='ready'&&p.status!=='done')return;lastProgress=now;
    send({type:'progress',id,progress:{state:p.status==='progress'?'downloading':'initializing',message:p.status==='progress'?'Downloading speech model':'Initializing local speech model',progress:p.progress,downloadedBytes:[...files.values()].reduce((a,b)=>a+b,0)}});
  };
  const gpu=(navigator as WorkerNavigator & {gpu?:{requestAdapter():Promise<unknown>}}).gpu;
  let gpuAvailable=false;if(nextBackend!=='wasm'&&gpu){try{gpuAvailable=!!await gpu.requestAdapter();}catch{}}
  if(nextBackend==='webgpu'&&!gpuAvailable)throw Error('WebGPU adapter is unavailable. Select CPU or Auto.');
  backend=nextBackend!=='wasm'&&gpuAvailable?'webgpu':'wasm';
  try {transcriber=await pipeline('automatic-speech-recognition',`Xenova/whisper-${model}`,{device:backend,dtype:'q8',progress_callback});}
  catch(error){
    if(backend!=='webgpu'||nextBackend!=='auto')throw error;
    backend='wasm';send({type:'progress',id,progress:{state:'initializing',message:'Graphics backend unavailable. Starting local CPU recognition.',backend}});
    transcriber=await pipeline('automatic-speech-recognition',`Xenova/whisper-${model}`,{device:'wasm',dtype:'q8',progress_callback});
  }
  if(notify)send({type:'loaded',id,backend,initMs:performance.now()-started,downloadedBytes:[...files.values()].reduce((a,b)=>a+b,0)});
}
async function handle(message:WorkerRequest):Promise<void> {
  if(message.type==='dispose'){await transcriber?.dispose();transcriber=undefined;return;}
  if(message.type==='load'){await load(message.id,message.model,message.backend);return;}
  if(!transcriber)throw Error('Model is unavailable. Load the model before listening.');
  validateAudio(message.audio,message.sampleRate);
  const audio=resampleMono(message.audio,message.sampleRate);
  const options=taskOptions(message.language,message.output),start=performance.now();
  let text='';
  if(audio.length>=1600&&rms(audio)>.003) {
    try {const result=await transcriber(audio,options);text=result.text.trim();}
    catch(error){
      if(backend!=='webgpu'||requestedBackend!=='auto')throw error;
      await load(message.id,model,'wasm',false);requestedBackend='auto';
      if(!transcriber)throw error;
      const result=await transcriber(audio,options);text=result.text.trim();
    }
  }
  validateTranscript(text,message.language,message.output);
  // The high-level pipeline does not return a trustworthy detected language. Never guess it.
  const sourceLanguage=message.language==='auto'?'und':message.language;
  const targetLanguage=message.output==='english'?'en':sourceLanguage;
  send({type:'result',id:message.id,session:message.session,result:{text,sourceLanguage,targetLanguage,task:options.task,backend,inferenceMs:performance.now()-start,audioSeconds:audio.length/16000}});
}
self.onmessage=(event:MessageEvent<WorkerRequest>)=>{
  const message=event.data;
  chain=chain.then(()=>handle(message)).catch(error=>{console.error('Local Whisper worker:',error);send({type:'error',id:message.id,message:inferenceError(error)});});
};
