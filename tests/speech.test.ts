import {describe,it,expect,vi} from 'vitest';
import {AudioSegmenter,resampleMono,rms,validateAudio} from '../src/speech/audio.js';
import {microphoneError} from '../src/speech/microphone.js';
import {taskOptions,validateTranscript,inferenceError} from '../src/speech/config.js';
import {speechEvent,SpeechSession,type CaptureDevice,type SpeechRecognizer} from '../src/speech/session.js';
import type {CaptionEvent} from '../src/captions/contracts.js';
import type {SpeechResult} from '../src/speech/contracts.js';
const result=(patch:Partial<SpeechResult>={}):SpeechResult=>({text:'Where is the station?',sourceLanguage:'hi',targetLanguage:'en',task:'translate',backend:'wasm',inferenceMs:1200,audioSeconds:4,...patch});
const tone=(rate:number,hz:number,seconds=1):Float32Array=>Float32Array.from({length:Math.round(rate*seconds)},(_,i)=>Math.sin(2*Math.PI*hz*i/rate)*.4);
function harness(){
 const events:CaptionEvent[]=[];let emit:(a:Float32Array,r:number)=>void=()=>{};
 let resolve:(r:SpeechResult)=>void=()=>{};
 const recognize=vi.fn(()=>new Promise<SpeechResult>(r=>{resolve=r;}));
 const recognizer:SpeechRecognizer={ready:true,backend:'wasm',load:vi.fn(async()=>{}),recognize,dispose:vi.fn()};
 const capture:CaptureDevice={active:false,start:vi.fn(async callback=>{emit=callback;capture.active=true;}),stop:vi.fn(()=>{capture.active=false;})};
 const onState=vi.fn();const session=new SpeechSession({receive:e=>{events.push(e);return true;}},onState,()=> 'asha',recognizer,capture);
 return {session,events,recognizer,capture,recognize,onState,emit:()=>emit(tone(16000,400,4),16000),resolve:(r=result())=>resolve(r)};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
describe('audio validation and actual rate conversion',()=>{
 it('rejects malformed, excessive and non-finite audio',()=>{expect(()=>validateAudio(new Float32Array([NaN]),48000)).toThrow();expect(()=>validateAudio(new Float32Array([1.5]),16000)).toThrow();expect(()=>validateAudio(new Float32Array(1),0)).toThrow();expect(()=>validateAudio(new Float32Array(16000*31),16000)).toThrow();});
 it('converts 48k and 44.1k to actual 16k sample counts',()=>{for(const rate of [48000,44100]){const output=resampleMono(tone(rate,440),rate);expect(output.length).toBe(16000);expect(rms(output)).toBeCloseTo(.4/Math.sqrt(2),2);}});
 it('attenuates signals above the new Nyquist limit',()=>{const output=resampleMono(tone(48000,14000),48000);expect(rms(output.subarray(100,-100))).toBeLessThan(.01);});
 it('handles empty input and same-rate copies',()=>{expect(resampleMono(new Float32Array(),48000)).toHaveLength(0);const x=tone(16000,200,.1);expect(resampleMono(x,16000)).toEqual(x);expect(resampleMono(x,16000)).not.toBe(x);});
 it('bounds segments and avoids prolonged-silence inference',()=>{const onSegment=vi.fn(),onSilence=vi.fn(),s=new AudioSegmenter(16000,onSegment,onSilence);for(let i=0;i<48;i++)s.push(new Float32Array(2000));expect(onSegment).not.toHaveBeenCalled();expect(onSilence).toHaveBeenCalledOnce();for(let i=0;i<48;i++)s.push(tone(16000,200,.125));expect(onSegment).toHaveBeenCalledOnce();expect(onSegment.mock.calls[0][0].length).toBe(96000);});
 it('ends voiced segments on silence after the minimum window',()=>{const onSegment=vi.fn(),s=new AudioSegmenter(16000,onSegment,()=>{});for(let i=0;i<20;i++)s.push(tone(16000,300,.125));for(let i=0;i<6;i++)s.push(new Float32Array(2000));expect(onSegment).toHaveBeenCalledOnce();expect(onSegment.mock.calls[0][0].length/16000).toBeGreaterThanOrEqual(3);});
});
describe('Whisper task semantics and event integrity',()=>{
 it('rejects the observed wrong-script Hindi original output without inventing a translation',()=>{expect(()=>validateTranscript('نمستی میرا نام آشا ہے','hi','original')).toThrow('different writing system');expect(()=>validateTranscript('नमस्ते railway station','hi','original')).not.toThrow();expect(inferenceError(Error('The model returned a different writing system for Hindi. Choose English output or retry.'))).toContain('Choose English');});
 it('transcribes English, translates Hindi/Spanish only to English',()=>{expect(taskOptions('en','english').task).toBe('transcribe');for(const l of ['hi','es'] as const){expect(taskOptions(l,'english').task).toBe('translate');expect(taskOptions(l,'original').task).toBe('transcribe');}expect(taskOptions('auto','english').language).toBeUndefined();});
 it('retains honest local provenance, manual association and absent confidence',()=>{const e=speechEvent(result(),2,4,'asha')!;expect(e.provenance).toBe('model-output');expect(e.inference?.runtime).toBe('local-whisper');expect(e.inference?.association).toBe('manual');expect(e.originalText).toBe('');expect(e.confidence).toBeUndefined();expect(e.sourceLanguage).toBe('hi');});
 it('keeps original transcription and unknown detected language honest',()=>{const e=speechEvent(result({task:'transcribe',sourceLanguage:'und',targetLanguage:'und'}),2,5)!;expect(e.originalText).toBe(e.displayText);expect(e.inference?.association).toBe('neutral');expect(e.speakerId).toBeUndefined();expect(e.sourceLanguage).toBe('und');expect(speechEvent(result({text:'   '}),1,1)).toBeUndefined();});
});
describe('live sessions, backpressure and stale results',()=>{
 it('reports microphone permission denial without entering listening',async()=>{const h=harness();h.capture.start=vi.fn(async()=>{throw new DOMException('Denied','NotAllowedError');});h.session.setMode(true);await h.session.start();expect(h.session.active).toBe(false);expect(h.session.state.state).toBe('error');expect(h.session.state.message).toContain('permission was denied');expect(h.events).toHaveLength(0);expect(microphoneError(new DOMException('Permission denied by system','NotAllowedError'))).toContain('system privacy settings');});
 it('moves through model initialization to ready without opening a microphone',async()=>{const h=harness();h.recognizer.ready=false;h.recognizer.load=vi.fn(async()=>{h.recognizer.ready=true;});const loading=h.session.load();expect(h.session.state.state).toBe('initializing');await loading;expect(h.session.state.state).toBe('ready');expect(h.capture.start).not.toHaveBeenCalled();});
 it('never starts capture in demo mode',async()=>{const h=harness();await h.session.start();expect(h.capture.start).not.toHaveBeenCalled();});
 it('requires a model and exposes model state errors',async()=>{const h=harness();h.session.setMode(true);h.recognizer.ready=false;await h.session.start();expect(h.capture.start).not.toHaveBeenCalled();expect(h.session.state.state).toBe('unloaded');h.recognizer.load=vi.fn(async()=>{throw Error('Unavailable model');});await h.session.load();expect(h.session.state.state).toBe('error');});
 it('emits real results through the existing sink',async()=>{const h=harness();h.session.setMode(true);await h.session.start();h.emit();h.resolve();await settle();expect(h.events).toHaveLength(1);expect(h.events[0].speakerId).toBe('asha');expect(h.session.state.state).toBe('caption');});
 it('discards in-flight results after stop and releases capture',async()=>{const h=harness();h.session.setMode(true);await h.session.start();h.emit();h.session.stop();h.resolve();await settle();expect(h.events).toHaveLength(0);expect(h.capture.active).toBe(false);});
 it('keeps demo/live separation even when a result completes late',async()=>{const h=harness();h.session.setMode(true);await h.session.start();h.emit();h.session.setMode(false);h.resolve();await settle();expect(h.events).toHaveLength(0);expect(h.session.live).toBe(false);});
 it('allows one operation and one pending segment, dropping excess input',async()=>{const h=harness();h.session.setMode(true);await h.session.start();h.emit();h.emit();h.emit();expect(h.recognize).toHaveBeenCalledOnce();expect(h.session.droppedSegments).toBe(1);h.resolve();await settle();expect(h.recognize).toHaveBeenCalledTimes(2);h.session.stop();h.resolve();await settle();expect(h.events).toHaveLength(1);});
 it('does not replace an inference error with demonstration text',async()=>{const h=harness();h.recognizer.recognize=vi.fn(async()=>{throw Error('Runtime failed');});h.session.setMode(true);await h.session.start();h.emit();await settle();expect(h.events).toHaveLength(0);expect(h.session.state.state).toBe('error');expect(h.capture.active).toBe(false);});
 it('does not produce captions from empty results',async()=>{const h=harness();h.session.setMode(true);await h.session.start();h.emit();h.resolve(result({text:''}));await settle();expect(h.events).toHaveLength(0);expect(h.session.state.state).toBe('empty');});
});

it('does not clear replacement inference when an unloaded worker settles', async () => {
 const h=harness();
 const calls:Array<(value:SpeechResult)=>void>=[];
 h.recognizer.recognize=vi.fn(()=>new Promise<SpeechResult>(resolve=>calls.push(resolve)));
 h.session.setMode(true);
 await h.session.start();
 h.emit();
 h.session.unload();
 const running=h.session.recognizeFixture(tone(16000,400),16000);
 calls[0](result());
 await settle();
 expect(h.session.busy).toBe(true);
 expect(h.events).toHaveLength(0);
 calls[1](result());
 await running;
 expect(h.session.busy).toBe(false);
 expect(h.events[0].inference).toMatchObject({input:'recorded-sample'});
});
