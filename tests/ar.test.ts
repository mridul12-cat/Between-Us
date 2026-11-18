import {describe,expect,it} from 'vitest';
import {captionPosition,containVideo,observeHead,projectPoint,WebcamAnchors} from '../src/ar/person-anchor';
import {emptyFrame,POSE_START} from '../src/sign/vendor/landmarks';
import {CaptionCoordinator} from '../src/captions/coordinator';
import type {CaptionEvent} from '../src/captions/contracts';

function pose(x:number,y=.45) {
  const frame=emptyFrame();
  frame.set([x,y,0],POSE_START*3);
  frame.set([x-.1,y+.21,0],(POSE_START+11)*3);
  frame.set([x+.1,y+.21,0],(POSE_START+12)*3);
  return frame;
}

describe('camera-aligned placement',()=>{
  it('letterboxes and mirrors once in CSS-pixel coordinates',()=>{
    const wide=containVideo(1000,400,640,480);
    expect(wide.height).toBe(400);
    expect(wide.x).toBeCloseTo(233.333);
    expect(projectPoint({x:.25,y:.5},wide,false)).toEqual({x:expect.closeTo(366.667,2),y:200});
    expect(projectPoint({x:.25,y:.5},wide,true)).toEqual({x:expect.closeTo(633.333,2),y:200});
    const tall=containVideo(400,800,640,480);
    expect(tall).toEqual({x:0,y:250,width:400,height:300});
  });

  it('keeps an above-head bubble within the image and finds a face-safe alternative',()=>{
    const rect=containVideo(960,540,960,540);
    const face={left:.78,right:.9,top:.36,bottom:.56};
    expect(captionPosition(face,rect,false,360,105)).toMatchObject({x:594,placement:'above'});
    expect(captionPosition({...face,top:.04},rect,true,360,105)?.placement).toBe('side');
    expect(captionPosition({left:0,right:1,top:0,bottom:1},rect,false,400,180)).toBeUndefined();
  });

  it('uses space above the camera image for a floating review without covering the face',()=>{
    const video={x:100,y:160,width:400,height:300};
    const area={x:10,y:50,width:580,height:410};
    const face={left:.4,right:.6,top:.1,bottom:.35};
    expect(captionPosition(face,video,false,260,90,area)).toMatchObject({x:170,placement:'above'});
    expect(captionPosition(face,video,false,580,90,area)).toBeUndefined();
  });

  it('places pose fallback only with a plausible nose and shoulders',()=>{
    expect(observeHead(emptyFrame())).toBeUndefined();
    const head=observeHead(pose(.4))!;
    expect(head.quality).toBe('pose');
    expect(head.bounds.top).toBeLessThan(head.head.y);
  });
});

describe('anonymous tracks',()=>{
  it('follows movement continuously, discards out-of-order observations and smooths motion',()=>{
    const tracker=new WebcamAnchors();
    tracker.update(pose(.4),1,10);
    const id=tracker.current(10)!.id;
    tracker.update(pose(.52),1,50);
    const moved=tracker.current(50)!;
    expect(moved.id).toBe(id);
    expect(moved.head.x).toBeGreaterThan(.4);
    expect(moved.head.x).toBeLessThan(.52);
    tracker.update(pose(.7),1,49);
    expect(tracker.current(51)?.head.x).toBe(moved.head.x);
  });

  it('holds the old anchor briefly but gives reacquisition and jumps a new ID',()=>{
    const tracker=new WebcamAnchors(750,350,100);
    tracker.update(pose(.4),1,10);
    const first=tracker.current(10)!.id;
    tracker.update(emptyFrame(),0,45);
    expect(tracker.current(46)).toMatchObject({id:first,status:'visible'});
    tracker.update(pose(.41),1,60);
    expect(tracker.current(60)?.id).toBe(first);
    tracker.update(emptyFrame(),0,80);
    expect(tracker.current(181)).toMatchObject({id:first,status:'uncertain'});
    tracker.update(pose(.4),1,200);
    const next=tracker.current(200)!.id;
    expect(next).not.toBe(first);
    tracker.update(pose(.66),1,250);
    expect(tracker.current(250)?.id).not.toBe(next);
    expect(tracker.current(1001)).toBeUndefined();
  });

  it('fails closed for multiple detections and clears between streams',()=>{
    const tracker=new WebcamAnchors();
    tracker.update(pose(.4),1,1);
    const first=tracker.current(1)!.id;
    tracker.update(pose(.4),2,2);
    expect(tracker.current(2)).toBeUndefined();
    expect(tracker.ambiguous).toBe(true);
    tracker.clear();
    tracker.update(pose(.4),1,1);
    expect(tracker.current(1)?.id).not.toBe(first);
  });

  it('retires pinned locations while preserving history; a stale destination resolves to neutral',()=>{
    const recipients=new Set(['camera-person-1']);
    const captions=new CaptionCoordinator(recipients);
    const event:CaptionEvent={id:'local-1',timestamp:100,modality:'speech',status:'final',
      originalText:'hola',displayText:'hello',sourceLanguage:'es',targetLanguage:'en',
      speakerId:'camera-person-1',provenance:'model-output'};
    expect(captions.receive(event)).toBe(true);
    captions.pin('camera-person-1');
    recipients.delete('camera-person-1');
    captions.retireAnchor('camera-person-1');
    expect(captions.active.size).toBe(0);
    expect(captions.history[0]).toMatchObject(event);
    recipients.add('camera-person-2');
    captions.receive({...event,id:'local-2',timestamp:101});
    expect(captions.active.has('camera-person-2')).toBe(false);
    expect(captions.active.get('neutral')?.event.provenance).toBe('model-output');
  });
});
