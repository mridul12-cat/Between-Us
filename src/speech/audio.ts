/** Whisper's processor expects 16 kHz mono floats; never relabel native-rate PCM. */
export const MODEL_SAMPLE_RATE=16000;
export function validateAudio(audio:Float32Array,sampleRate:number):void {
  if(!(audio instanceof Float32Array)||!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw Error('Invalid audio format.');
  if(audio.length>sampleRate*30)throw Error('Audio segment is too long.');
  for(const x of audio)if(!Number.isFinite(x)||Math.abs(x)>1.01)throw Error('Audio contains invalid samples.');
}
export function rms(audio:Float32Array):number {let sum=0;for(const x of audio)sum+=x*x;return Math.sqrt(sum/Math.max(audio.length,1));}
/** Windowed-sinc low-pass resampling, including anti-alias filtering on downsampling. */
export function resampleMono(audio:Float32Array,sourceRate:number,targetRate=MODEL_SAMPLE_RATE):Float32Array {
  validateAudio(audio,sourceRate);
  if(!Number.isFinite(targetRate)||targetRate<8000||targetRate>192000)throw Error('Invalid target sample rate.');
  if(sourceRate===targetRate)return audio.slice();
  const ratio=sourceRate/targetRate,cutoff=Math.min(1,targetRate/sourceRate)*0.94,radius=24;
  const output=new Float32Array(Math.round(audio.length/ratio));
  for(let i=0;i<output.length;i++) {
    const position=i*ratio,center=Math.floor(position);let sum=0,weight=0;
    for(let j=center-radius+1;j<=center+radius;j++) {
      if(j<0||j>=audio.length)continue;
      const d=position-j;if(Math.abs(d)>=radius)continue;
      const x=Math.PI*d*cutoff;
      const kernel=(Math.abs(x)<1e-8?1:Math.sin(x)/x)*(.5+.5*Math.cos(Math.PI*d/radius));
      sum+=audio[j]*kernel;weight+=kernel;
    }
    output[i]=Math.max(-1,Math.min(1,weight?sum/weight:0));
  }
  return output;
}
export class AudioSegmenter {
  private chunks:Float32Array[]=[];
  private length=0;
  private voiced=0;
  private silence=0;
  constructor(private readonly sampleRate:number,private readonly onSegment:(audio:Float32Array,sampleRate:number)=>void,private readonly onSilence:()=>void){}
  push(chunk:Float32Array):void {
    const max=Math.round(this.sampleRate*6);
    // A malformed producer cannot grow the bounded capture window.
    if(chunk.length>max||this.length+chunk.length>max+4096) {this.clear();return;}
    const loud=rms(chunk)>.008;
    this.chunks.push(chunk);this.length+=chunk.length;
    if(loud){this.voiced+=chunk.length;this.silence=0;}else this.silence+=chunk.length;
    if(this.length>=max||(this.length>=this.sampleRate*3&&this.voiced>=this.sampleRate*.25&&this.silence>=this.sampleRate*.7)) {
      if(this.voiced>=this.sampleRate*.25){const all=new Float32Array(this.length);let offset=0;for(const c of this.chunks){all.set(c,offset);offset+=c.length;}this.onSegment(all,this.sampleRate);}
      else this.onSilence();
      this.clear();
    }
  }
  clear():void{this.chunks=[];this.length=0;this.voiced=0;this.silence=0;}
}
