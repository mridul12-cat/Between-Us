/** Model-independent boundary. No adapter is allowed to infer identity from text. */
export type Language = 'en' | 'hi' | 'es';
export type CaptionLanguage = Language | 'und' | 'ase';
export type RecognitionStatus = 'waiting' | 'receiving' | 'final' | 'uncertain' | 'cancelled';
export interface CaptionEvent {
  id: string;
  modality: 'speech' | 'sign';
  originalText: string;
  displayText: string;
  sourceLanguage: CaptionLanguage;
  targetLanguage: CaptionLanguage;
  speakerId?: string;
  confidence?: number;
  timestamp: number;
  status: RecognitionStatus;
  provenance: 'predefined-demo' | 'model-output';
  inference?: {runtime:'local-whisper';task:'transcribe'|'translate';input?:'microphone'|'recorded-sample';backend:'webgpu'|'wasm';association:'manual'|'neutral'|'camera-track'} | {runtime:'local-gesturesign';task:'isolated-sign';backend:'wasm';association:'manual'|'neutral'|'camera-track';modelVersion:string;input:'webcam'|'reference-replay';confirmed:boolean;score:number};
}
export type CaptionState = 'waiting' | 'receiving' | 'displaying' | 'uncertain' | 'pinned' | 'paused' | 'expired';
export interface CaptionRecord {
  event: CaptionEvent;
  association: 'known' | 'neutral';
  anchorId: string;
  age: number;
  pinned: boolean;
  expanded: boolean;
  state: CaptionState;
}
export interface CaptionSink { receive(event: CaptionEvent): boolean }
