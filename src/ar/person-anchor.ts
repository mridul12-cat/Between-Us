import { N_FACE, POSE_START, type Frame } from '../sign/vendor/landmarks';

export interface Point { x: number; y: number }
export interface Bounds { left: number; top: number; right: number; bottom: number }
export interface HeadObservation {
  head: Point;
  bounds: Bounds;
  quality: 'face' | 'pose';
}

export interface PersonTrack extends HeadObservation {
  id: string;
  space: 'normalized-video';
  observedAt: number;
  status: 'visible' | 'uncertain';
}

export interface SpatialPersonAnchorProvider<T = PersonTrack> {
  current(now: number): T | undefined;
}

function point(frame: Frame, index: number): Point | undefined {
  const x = frame[index * 3], y = frame[index * 3 + 1];
  if (Number.isFinite(x) && Number.isFinite(y) && x >= -0.05 && x <= 1.05 && y >= -0.05 && y <= 1.05) return {x,y};
}

export function observeHead(frame: Frame): HeadObservation | undefined {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, count = 0;
  for (let i = 0; i < N_FACE; i++) {
    const p = point(frame,i);
    if (!p) continue;
    left = Math.min(left,p.x); top = Math.min(top,p.y);
    right = Math.max(right,p.x); bottom = Math.max(bottom,p.y);
    count++;
  }
  if (count >= 60 && right-left > 0.015 && bottom-top > 0.02) {
    return {head:{x:(left+right)/2,y:(top+bottom)/2}, bounds:{left,top,right,bottom}, quality:'face'};
  }
  const nose = point(frame,POSE_START);
  const a = point(frame,POSE_START+11), b = point(frame,POSE_START+12);
  if (!nose || !a || !b) return;
  const width = Math.min(0.18, Math.abs(a.x-b.x)*0.32);
  const height = Math.min(0.24, ((a.y+b.y)/2-nose.y)*0.6);
  if (width < 0.012 || height < 0.018) return;
  return {head:nose,bounds:{left:nose.x-width,right:nose.x+width,top:nose.y-height,bottom:nose.y+height}, quality:'pose'};
}

// One local track. Brief detector gaps hold position; a sustained gap or
// discontinuity gets a new anchor ID.
export class WebcamAnchors implements SpatialPersonAnchorProvider {
  private serial = 0;
  private track?: PersonTrack;
  private missingSince?: number;
  private lastFrame = -Infinity;
  ambiguous = false;

  constructor(private readonly expiryMs = 1250, private readonly freshMs = 800, private readonly gapMs = 400) {}

  update(frame: Frame, poses: number, now: number): void {
    if (now <= this.lastFrame) return;
    this.lastFrame = now;
    this.ambiguous = poses > 1;
    const head = this.ambiguous ? undefined : observeHead(frame);
    if (!head) {
      this.missingSince ??= now;
      if (this.ambiguous) this.track = undefined;
      return;
    }
    const old = this.track;
    const elapsed = now - (old?.observedAt ?? now);
    if (!old || (this.missingSince!==undefined && now-this.missingSince>=this.gapMs) || elapsed > this.freshMs ||
        Math.hypot(old.head.x-head.head.x,old.head.y-head.head.y) > 0.23) {
      this.track = {...head,id:`camera-person-${++this.serial}`,space:'normalized-video',observedAt:now,status:'visible'};
    } else {
      const alpha = 1-Math.exp(-elapsed/85);
      const blend = (a:number,b:number) => a+(b-a)*alpha;
      this.track = {...old,observedAt:now,quality:head.quality,
        head:{x:blend(old.head.x,head.head.x),y:blend(old.head.y,head.head.y)},
        bounds:{left:blend(old.bounds.left,head.bounds.left),top:blend(old.bounds.top,head.bounds.top),
          right:blend(old.bounds.right,head.bounds.right),bottom:blend(old.bounds.bottom,head.bounds.bottom)}};
    }
    this.missingSince = undefined;
  }

  current(now: number): PersonTrack | undefined {
    if (!this.track) return;
    const age = now-this.track.observedAt;
    if (age >= this.expiryMs) { this.track=undefined; return; }
    if ((this.missingSince!==undefined && now-this.missingSince>=this.gapMs) || age > this.freshMs) return {...this.track,status:'uncertain'};
    return this.track;
  }

  clear(): void {
    this.track=undefined;
    this.ambiguous=false;
    this.missingSince=undefined;
    this.lastFrame=-Infinity;
  }
}

export function containVideo(width:number,height:number,videoWidth:number,videoHeight:number) {
  const scale = Math.min(width/videoWidth,height/videoHeight);
  const w = videoWidth*scale, h = videoHeight*scale;
  return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};
}

export function projectPoint(point:Point, rect:ReturnType<typeof containVideo>, mirror:boolean):Point {
  return {x:rect.x+(mirror?1-point.x:point.x)*rect.width,y:rect.y+point.y*rect.height};
}

export function captionPosition(
  bounds:Bounds, rect:ReturnType<typeof containVideo>, mirror:boolean, width:number, height:number, area=rect,
) {
  const mid = projectPoint({x:(bounds.left+bounds.right)/2,y:bounds.top},rect,mirror);
  const bottom = projectPoint({x:0,y:bounds.bottom},rect,mirror).y;
  const gap = Math.max(8,Math.min(24,(bottom-mid.y)*0.2));
  const minX=area.x+6, maxX=area.x+area.width-width-6;
  if(maxX<minX||height>area.height-12)return undefined;
  const fitX=(x:number)=>Math.max(minX,Math.min(x,maxX));
  const above=mid.y-gap-height;
  if (above >= area.y+6) return {x:fitX(mid.x-width/2),y:above,placement:'above'} as const;
  const edges=[projectPoint({x:bounds.left,y:0},rect,mirror).x,projectPoint({x:bounds.right,y:0},rect,mirror).x];
  const [left,right]=[Math.min(...edges),Math.max(...edges)];
  const y=Math.max(area.y+6,Math.min(mid.y,area.y+area.height-height-6));
  if (right+gap <= maxX) return {x:right+gap,y,placement:'side'} as const;
  if (left-gap-width >= minX) return {x:left-gap-width,y,placement:'side'} as const;
  if (bottom+gap+height <= area.y+area.height-6) return {x:fitX(mid.x-width/2),y:bottom+gap,placement:'below'} as const;
  return undefined;
}
