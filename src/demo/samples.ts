import type { CaptionEvent, Language } from '../captions/contracts.js';
export const speakers = [
  { id:'asha', name:'Asha', language:'Hindi', x:-1.55, z:-3.15, color:'#479c92' },
  { id:'lucia', name:'Lucia', language:'Spanish', x:0, z:-3.7, color:'#897dac' },
  { id:'alex', name:'Alex', language:'English', x:1.55, z:-3.15, color:'#c99555' },
] as const;
export type DemoScene = 'single' | 'alternating' | 'moving' | 'long' | 'pinned' | 'switching' | 'uncertain' | 'unknown';
export const scenes: DemoScene[]=['single','alternating','moving','long','pinned','switching','uncertain','unknown'];
const copy: Record<string, Record<Language,string>> = {
  asha:{en:'Hello! How are you?',hi:'नमस्ते! आप कैसे हैं?',es:'¡Hola! ¿Cómo estás?'},
  lucia:{en:'Where is the station?',hi:'स्टेशन कहाँ है?',es:'¿Dónde está la estación?'},
  alex:{en:'Welcome to Between Us.',hi:'बिटवीन अस में आपका स्वागत है।',es:'Bienvenidos a Between Us.'},
  long:{en:'Every conversation deserves to be understood. A small moment of understanding can bring us closer, wherever we come from and however we choose to express ourselves.',hi:'हर बातचीत समझी जानी चाहिए। समझ का एक छोटा सा पल हमें करीब ला सकता है, चाहे हम कहीं से भी आए हों और किसी भी तरह अपनी बात कहें।',es:'Toda conversación merece ser comprendida. Un pequeño momento de entendimiento puede acercarnos, sin importar de dónde venimos ni cómo elegimos expresarnos.'},
};
export class DemoController {
  scene: DemoScene='alternating';
  private sequence=0;
  private time=1000;
  make(speakerId:string,target:Language): CaptionEvent {
    const source:Language=speakerId==='asha'?'hi':speakerId==='lucia'?'es':'en';
    const text=copy[this.scene==='long'?'long':speakerId]??copy.alex;
    return {id:`demo-${++this.sequence}`,modality:'speech',originalText:text[source],displayText:text[target],
      sourceLanguage:source,targetLanguage:target,speakerId:this.scene==='unknown'?'unregistered-person':speakerId,
      timestamp:++this.time,status:this.scene==='uncertain'?'uncertain':'final',
      confidence:this.scene==='uncertain'?0.54:undefined,provenance:'predefined-demo'};
  }
  translate(event:CaptionEvent,target:Language): CaptionEvent {
    const text=copy[this.scene==='long'?'long':event.speakerId??'alex']??copy.alex;
    return {...event,displayText:text[target],targetLanguage:target,timestamp:++this.time};
  }
}
