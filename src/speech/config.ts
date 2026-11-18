import type { InputLanguage, SpeechOutput } from './contracts.js';
export function taskOptions(language:InputLanguage,output:SpeechOutput):{language?:string;task:'transcribe'|'translate';max_new_tokens:number;num_beams:number} {
  const task=output==='original'||language==='en'?'transcribe':'translate';
  return {language:language==='auto'?undefined:{en:'english',hi:'hindi',es:'spanish'}[language],task,max_new_tokens:96,num_beams:1};
}
export function validateTranscript(text:string,language:InputLanguage,output:SpeechOutput):void {
  if(language==='hi'&&output==='original'&&/[\u0600-\u06ff]/u.test(text)&&!/[\u0900-\u097f]/u.test(text))
    throw Error('The model returned a different writing system for Hindi. Choose English output or retry.');
}
export function inferenceError(error:unknown):string {
  const detail=error instanceof Error?error.message:String(error);
  if(detail.startsWith('The model returned a different writing system'))return detail;
  if(/memory|allocat|out of bounds/i.test(detail))return 'Not enough memory for this model. Select Tiny and try again.';
  if(/fetch|network|download|offline|HTTP|404|load.*file/i.test(detail))return 'Model files could not be loaded. Connect to the internet for the initial download, then retry.';
  if(/webgpu|gpu|adapter|device/i.test(detail))return 'The graphics inference backend failed. Select CPU or Auto in settings and retry.';
  if(/wasm|webassembly/i.test(detail))return 'The local CPU runtime could not start. Try a current Chrome browser and reload.';
  return 'Local speech recognition failed. Stop, then retry; Tiny uses less memory.';
}
