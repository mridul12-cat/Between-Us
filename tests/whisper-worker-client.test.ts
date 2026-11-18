import {afterEach,describe,it,expect,vi} from 'vitest';
import {WhisperAdapter} from '../src/speech/whisper-adapter.js';
import type {WorkerResponse,WorkerRequest,SpeechOptions} from '../src/speech/contracts.js';
class FakeWorker {
 static latest:FakeWorker;
 onmessage:((e:MessageEvent<WorkerResponse>)=>void)|null=null;
 onerror:(()=>void)|null=null;
 sent:WorkerRequest[]=[];
 terminated=false;
 constructor(){FakeWorker.latest=this;}
 postMessage(message:WorkerRequest){this.sent.push(message);}
 terminate(){this.terminated=true;}
 answer(response:WorkerResponse){this.onmessage?.({data:response}as MessageEvent<WorkerResponse>);}
}
const options:SpeechOptions={model:'tiny',backend:'wasm',language:'hi',output:'english'};
afterEach(()=>vi.unstubAllGlobals());
describe('typed worker communication',()=>{
 it('tracks load progress and matches responses by operation ID',async()=>{
  vi.stubGlobal('Worker',FakeWorker);const progress=vi.fn(),client=new WhisperAdapter(progress);
  const load=client.load(options);const w=FakeWorker.latest,id=w.sent[0].id;
  w.answer({type:'progress',id,progress:{state:'downloading',message:'Downloading model',progress:42}});
  w.answer({type:'loaded',id,backend:'wasm',initMs:1234,downloadedBytes:40000000});await load;
  expect(client.ready).toBe(true);expect(client.backend).toBe('wasm');expect(progress.mock.calls.some(c=>c[0].progress===42)).toBe(true);
  const pending=client.recognize(new Float32Array(16000),16000,options,7);const request=w.sent[1];
  expect(request.type).toBe('recognize');
  w.answer({type:'result',id:request.id,session:7,result:{text:'Hello',task:'translate',sourceLanguage:'hi',targetLanguage:'en',backend:'wasm',audioSeconds:1,inferenceMs:120}});
  expect((await pending).text).toBe('Hello');client.dispose();expect(w.terminated).toBe(true);
 });
 it('rejects unavailable models instead of supplying a demo',async()=>{
  vi.stubGlobal('Worker',FakeWorker);const client=new WhisperAdapter(()=>{});const load=client.load(options),w=FakeWorker.latest;
  w.answer({type:'error',id:w.sent[0].id,message:'Model files unavailable'});await expect(load).rejects.toThrow('unavailable');expect(client.ready).toBe(false);client.dispose();
 });
 it('invalidates pending work and ignores stale messages after disposal',async()=>{
  vi.stubGlobal('Worker',FakeWorker);const progress=vi.fn(),client=new WhisperAdapter(progress),load=client.load(options),w=FakeWorker.latest;
  const failure=expect(load).rejects.toThrow('cancelled');client.dispose();await failure;
  const previous=progress.mock.calls.length;w.answer({type:'progress',id:w.sent[0].id,progress:{state:'downloading',message:'Late progress'}});expect(progress.mock.calls.length).toBe(previous);w.answer({type:'loaded',id:w.sent[0].id,backend:'wasm',initMs:2,downloadedBytes:4});expect(client.ready).toBe(false);
 });
});
