import type { Language } from '../captions/contracts.js';
export type SpeechModel = 'tiny' | 'base';
export type SpeechBackend = 'auto' | 'webgpu' | 'wasm';
export type InputLanguage = Language | 'auto';
export type SpeechOutput = 'english' | 'original';
export type SpeechState = 'unloaded' | 'downloading' | 'initializing' | 'ready' | 'listening' | 'processing' | 'caption' | 'empty' | 'error';
export interface SpeechOptions { model:SpeechModel; backend:SpeechBackend; language:InputLanguage; output:SpeechOutput }
export interface SpeechResult { text:string; sourceLanguage:Language|'und'; targetLanguage:Language|'und'; task:'transcribe'|'translate'; backend:'webgpu'|'wasm'; inferenceMs:number; audioSeconds:number }
export interface SpeechProgress { state:SpeechState; message:string; progress?:number; backend?:'webgpu'|'wasm'; initMs?:number; downloadedBytes?:number }
export type WorkerRequest = {type:'load';id:number;model:SpeechModel;backend:SpeechBackend} | {type:'recognize';id:number;session:number;audio:Float32Array;sampleRate:number;language:InputLanguage;output:SpeechOutput} | {type:'dispose';id:number};
export type WorkerResponse = {type:'progress';id:number;progress:SpeechProgress} | {type:'loaded';id:number;backend:'webgpu'|'wasm';initMs:number;downloadedBytes:number} | {type:'result';id:number;session:number;result:SpeechResult} | {type:'error';id:number;message:string};
