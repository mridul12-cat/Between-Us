import {beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseMeta,parseLabels} from '../src/sign/vendor/meta';
import {decodeReplay} from '../src/sign/vendor/clips';
import {CaptionCoordinator} from '../src/captions/coordinator';
import {SignSession,signEvent,englishSignLabels,type SignPrediction} from '../src/sign/session';
const mocks=vi.hoisted(()=>({infer:vi.fn(),dispose:vi.fn(),load:vi.fn(),cameraStart:vi.fn()}));
vi.mock('../src/sign/vendor/model-client',()=>({ModelClient:{load:(...args:unknown[])=>mocks.load(...args)}}));
vi.mock('../src/sign/camera',()=>({CameraInput:class {active=false;video={};async start(){await mocks.cameraStart();this.active=true;}stop(){this.active=false;}},cameraError:(e:Error)=>e.message}));
vi.mock('../src/sign/vendor/tracker-client',()=>({TrackerClient:{create:vi.fn()}}));
vi.mock('../src/sign/vendor/clips',async original=>{const actual=await original<typeof import('../src/sign/vendor/clips')>();return {...actual,loadReplayClips:async()=>actual.decodeReplay(JSON.parse(readFileSync('public/sign/replay/clips.json','utf8'))).clips};});
const meta=parseMeta(JSON.parse(readFileSync('public/sign/models/model-meta.json','utf8'))),labels=parseLabels(JSON.parse(readFileSync('public/sign/models/labels.json','utf8')),meta.classes);
const prediction:SignPrediction={candidates:[{label:'hello',index:1,score:.7},{label:'after',index:2,score:.2}],uncertain:false,speakerId:'asha',input:'webcam',modelVersion:meta.version,inferenceMs:10,frames:32};
const logits=new Float32Array(250);logits[1]=30;
beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('navigator',{mediaDevices:{addEventListener:vi.fn(),removeEventListener:vi.fn(),enumerateDevices:async()=>[]}});
 mocks.infer.mockResolvedValue({logits,embedding:new Float32Array(128),ms:5});
 mocks.load.mockResolvedValue({meta,labels,client:{infer:mocks.infer,dispose:mocks.dispose}});
});
function harness(){const sink=new CaptionCoordinator(new Set(['asha']));const sign=new SignSession(sink,()=>{},()=> 'asha');sign.setEnabled(true);return {sign,sink};}
describe('sign captions and communication policy',()=>{
 it('uses ASL provenance and a separate score, without claiming confidence',()=>{const event=signEvent(prediction,0,true,'sign-1')!;expect(event.sourceLanguage).toBe('ase');expect(event.confidence).toBeUndefined();expect(event.inference).toMatchObject({runtime:'local-gesturesign',association:'manual',score:.7,confirmed:true});const coordinator=new CaptionCoordinator(new Set(['asha']));expect(coordinator.receive(event)).toBe(true);expect(coordinator.active.get('asha')?.event.modality).toBe('sign');});
 it('requires confirmation, supports alternate selection and dismisses without emitting',()=>{const {sign,sink}=harness();sign.pending=prediction;expect(sink.history).toHaveLength(0);sign.choose(1);expect(sign.confirm()).toBe(true);expect(sink.history[0].displayText).toBe('after');expect(sign.confirm()).toBe(false);sign.pending=prediction;sign.dismiss();expect(sink.history).toHaveLength(1);sign.dispose();});
 it('preserves uncertainty after explicit confirmation and refuses uncertain automatic output',()=>{const {sign,sink}=harness();sign.pending={...prediction,uncertain:true};expect(sign.confirm(false)).toBe(false);expect(sink.history).toHaveLength(0);sign.confirm();expect(sink.history[0].status).toBe('uncertain');sign.dispose();});
 it('preserves neutral assignment and rejects unavailable sign translations',async()=>{const event=signEvent({...prediction,speakerId:undefined},0,true,'sign-2')!;expect(event.inference?.association).toBe('neutral');expect(await englishSignLabels.translate('hello','en')).toBe('hello');await expect(englishSignLabels.translate('hello','hi')).rejects.toThrow('English only');});
 it('invalidates unconfirmed results on stop or mode change',()=>{const {sign,sink}=harness();sign.pending=prediction;sign.stop();expect(sign.confirm()).toBe(false);sign.pending=prediction;sign.setEnabled(false);expect(sign.confirm()).toBe(false);expect(sink.history).toHaveLength(0);sign.dispose();});
});
describe('sign session async lifecycle',()=>{
 it('never requests the camera before Sign mode or an explicit Start',async()=>{const {sign}=harness();expect(mocks.cameraStart).not.toHaveBeenCalled();sign.setEnabled(false);await sign.start();expect(mocks.cameraStart).not.toHaveBeenCalled();sign.dispose();});
 it('completes automatic replay after the proposal has been committed',async()=>{const {sign,sink}=harness();sign.autoDisplay=true;const prediction=await sign.replay(0);expect(prediction).toBeDefined();expect(sink.history).toHaveLength(1);expect(sign.pending).toBeUndefined();expect(sign.state).toBe('looking');sign.dispose();});
 it('reports a missing model without fallback output',async()=>{const {sign,sink}=harness();mocks.load.mockRejectedValueOnce(Error('Model missing'));await sign.replay(0);expect(sign.state).toBe('unavailable');expect(sign.message).toContain('Model missing');expect(sink.history).toHaveLength(0);sign.dispose();});
 it('disposes a late model initialization after Stop',async()=>{const {sign,sink}=harness();let resolve:(v:unknown)=>void=()=>{};mocks.load.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const loading=sign.replay(0);sign.stop();resolve({meta,labels,client:{infer:mocks.infer,dispose:mocks.dispose}});await loading;expect(mocks.dispose).toHaveBeenCalled();expect(sign.pending).toBeUndefined();expect(sink.history).toHaveLength(0);sign.dispose();});
 it('discards a genuine pipeline-shaped inference completing after mode switch',async()=>{const {sign,sink}=harness();let resolve:(v:unknown)=>void=()=>{};mocks.infer.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const loading=sign.replay(0);await vi.waitFor(()=>expect(mocks.infer).toHaveBeenCalled());sign.setEnabled(false);resolve({logits,embedding:new Float32Array(128),ms:9});await loading;expect(sign.pending).toBeUndefined();expect(sink.history).toHaveLength(0);sign.dispose();});
});

it('requires explicit confirmation for the public reference even with automatic live display',async()=>{
 const {sign,sink}=harness();
 sign.autoDisplay=true;
 const reference=await sign.replay(0,true);
 expect(reference?.input).toBe('reference-replay');
 expect(sign.pending).toBeDefined();
 expect(sink.history).toHaveLength(0);
 expect(sign.confirm()).toBe(true);
 expect(sink.history[0].inference).toMatchObject({input:'reference-replay',confirmed:true});
 sign.dispose();
});

describe('live review and rearming',()=>{
 const blue=decodeReplay(JSON.parse(readFileSync('public/sign/replay/clips.json','utf8'))).clips[0];
 const still=blue.frames[Math.floor(blue.frames.length/2)];
 const runSign=(sign:SignSession, start=0)=>{
   const step=1000/blue.fps;
   blue.frames.forEach((frame,i)=>sign.pushShared({frame,t:start+i*step,poses:1,ms:4},true));
   const empty=new Float32Array(still.length).fill(NaN);
   for(let i=0;i<12;i++)sign.pushShared({frame:empty,t:start+(blue.frames.length+i)*step,poses:1,ms:4},true);
   return start+(blue.frames.length+12)*step;
 };

 it('keeps close alternatives in review with automatic confirmation enabled',async()=>{
   const {sign,sink}=harness();
   const close = new Float32Array(250).fill(-20);
   close[1]=meta.calibration.temperature*Math.log(.55);
   close[2]=meta.calibration.temperature*Math.log(.45);
   mocks.infer.mockResolvedValueOnce({logits:close,embedding:new Float32Array(128),ms:5});
   sign.autoDisplay=true;
   await sign.startShared();
   runSign(sign);
   await vi.waitFor(()=>expect(sign.state).toBe('not-sure'));
   expect(sign.pending?.reason).toBe('close-alternatives');
   expect(sign.diagnosticLines()).toContain('Model: 55% (gap 10%)');
   expect(sign.confirm(false)).toBe(false);
   expect(sink.history).toHaveLength(0);
   expect(sign.confirm()).toBe(true);
   expect(sink.history[0].inference?.confirmed).toBe(true);
   sign.dispose();
 });

 it('ignores a stationary hand and requires quiet before collecting new motion after review',async()=>{
   const {sign,sink}=harness();
   await sign.startShared();
   for(let i=0;i<30;i++)sign.pushShared({frame:still,t:i*33,poses:1,ms:4},true);
   expect(mocks.infer).not.toHaveBeenCalled();
   expect(sign.message).toContain('No sign detected');

   let time=runSign(sign,1000);
   await vi.waitFor(()=>expect(sign.state).toBe('recognized'));
   expect(sign.confirm()).toBe(true);
   expect(sign.snapshot().diagnostics.segmentation).toBe('waiting for rest');
   // A second movement starts before the required pause and must never open another review.
   time=runSign(sign,time);
   expect(mocks.infer).toHaveBeenCalledTimes(1);
   expect(sink.history).toHaveLength(1);

   for(let i=0;i<13;i++)sign.pushShared({frame:still,t:time+i*33,poses:1,ms:4},true);
   runSign(sign,time+440);
   await vi.waitFor(()=>expect(mocks.infer).toHaveBeenCalledTimes(2));
   sign.dispose();
 });
});
