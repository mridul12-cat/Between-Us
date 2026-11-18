declare class AudioWorkletProcessor { readonly port:MessagePort; }
declare function registerProcessor(name:string,processor:typeof AudioWorkletProcessor):void;
class CaptureProcessor extends AudioWorkletProcessor {
  private samples=new Float32Array(2048);
  private offset=0;
  process(inputs:Float32Array[][],outputs:Float32Array[][]):boolean {
    const channels=inputs[0];
    if(channels?.length)for(let i=0;i<channels[0].length;i++) {
      let sample=0;for(const channel of channels)sample+=channel[i]??0;
      this.samples[this.offset++]=Math.max(-1,Math.min(1,sample/channels.length));
      if(this.offset===this.samples.length){const batch=this.samples;this.port.postMessage(batch,[batch.buffer]);this.samples=new Float32Array(2048);this.offset=0;}
    }
    for(const output of outputs)for(const channel of output)channel.fill(0);
    return true;
  }
}
registerProcessor('between-us-capture',CaptureProcessor);
export {};
