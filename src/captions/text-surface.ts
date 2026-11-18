import { CanvasTexture, SRGBColorSpace, UIKit } from '@iwsdk/core';

/** Browser shaping preserves Hindi conjuncts. Texture is local and changes only with content. */
export class TextSurface {
  readonly image;
  readonly canvas = document.createElement('canvas');
  private texture: CanvasTexture;
  private readonly context: CanvasRenderingContext2D;
  constructor(private readonly width: number, private readonly maxHeight=1400) {
    this.canvas.width=1200; this.canvas.height=512;
    this.context=this.canvas.getContext('2d')!;
    this.texture=new CanvasTexture(this.canvas); this.texture.colorSpace=SRGBColorSpace;
    this.image=new UIKit.Image({src:this.texture,width,height:100,objectFit:'fill',keepAspectRatio:false});
    this.image.name='ShapedCaptionText';
  }
  draw(text:string,fontSize:number,color:string): number {
    const ctx=this.context;
    const pixels=fontSize*1200/this.width;
    ctx.font=`500 ${pixels}px Arial, sans-serif`;
    const lines:string[]=[];
    for(const paragraph of text.split('\n')) {
      let line='';
      for(const word of paragraph.split(' ')) {
        const next=line?`${line} ${word}`:word;
        if(ctx.measureText(next).width>1180 && line) {lines.push(line);line=word;} else line=next;
        // Break unspaced pathological input, without separating combining marks.
        if(ctx.measureText(line).width>1180) {
          let segment='';
          for(const glyph of line) { if(ctx.measureText(segment+glyph).width>1180) { lines.push(segment);segment=''; } segment+=glyph; }
          line=segment;
        }
      }
      lines.push(line);
    }
    const leading=pixels*1.48;
    const height=Math.min(this.maxHeight,Math.ceil(lines.length*leading+20));
    this.canvas.height=height;
    ctx.font=`500 ${pixels}px Arial, sans-serif`; ctx.fillStyle=color; ctx.textBaseline='top';
    let y=8;
    for(const line of lines) { if(y+leading>height+10) break; ctx.fillText(line,4,y); y+=leading; }
    // UIKit atlases reserve texture dimensions. Replace the texture on layout changes
    // instead of resizing an already-atlased source, which can overflow its slot.
    const previous=this.texture;
    this.texture=new CanvasTexture(this.canvas);this.texture.colorSpace=SRGBColorSpace;
    const uiHeight=height/1200*this.width;
    this.image.setProperties({src:this.texture,height:uiHeight});
    previous.dispose();
    return uiHeight;
  }
  dispose():void {this.image.dispose();this.texture.dispose();}
}
