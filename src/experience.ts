import { createSystem, Hovered, Pressed, UIKitMLAsset, VisibilityState, UIKit, VideoTexture, SRGBColorSpace } from '@iwsdk/core';
import { ArViewport } from './ar/viewport';
import { SignSession } from './sign/session.js';
import { SpeechSession } from './speech/session.js';
import { Speaker } from './components.js';
import { CaptionCoordinator } from './captions/coordinator.js';
import type { Language, CaptionEvent } from './captions/contracts.js';
import { SpatialCaptionEngine, captionSource, type ReadingPreferences } from './captions/spatial-engine.js';
import { TextSurface } from './captions/text-surface.js';
import { DemoController, scenes, speakers, type DemoScene } from './demo/samples.js';

function createPreview(texture:VideoTexture){return new UIKit.Image({src:texture,width:160,height:120,objectFit:'fill',keepAspectRatio:false});}

const guidedSteps = [
  {speaker: 'asha', language: 'hi', message: 'Asha greets you in Hindi.'},
  {speaker: 'asha', language: 'en', message: 'The same greeting is shown in English.'},
  {speaker: 'lucia', language: 'es', message: 'Lucia asks a question in Spanish.'},
  {speaker: 'lucia', language: 'en', message: 'Speech can translate Hindi or Spanish into English.'},
  {speaker: 'alex', language: 'en', message: 'Try Sign for isolated ASL. Understanding can bring us together.'},
] as const;

export class ExperienceSystem extends createSystem({
  people:{required:[Speaker]}, selected:{required:[Speaker,Pressed]}, hovered:{required:[Speaker,Hovered]},
}) {
  private readonly recipients=new Set<string>(speakers.map(s=>s.id));
  readonly captions=new CaptionCoordinator(this.recipients);
  private ar?:ArViewport;
  readonly demo=new DemoController();
  readonly preferences:ReadingPreferences={size:24,contrast:false,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
  private engine!:SpatialCaptionEngine;
  private speech!:SpeechSession;
  private sign!:SignSession;
  private inputMode:'demo'|'speech'|'sign'='demo';
  private preview=false;
  private previewImage!:ReturnType<typeof createPreview>;
  private previewTexture!:VideoTexture;
  private wasImmersive=false;
  private toolbar!:UIKitMLAsset;
  private toolbarRestY=0;
  private settingsPanel!:UIKitMLAsset;
  private diagnosticsOpen=false;
  private guideStep=-1;
  private guideMessage='';
  private sampleError='';
  private fileDialog?:HTMLDialogElement;
  private sampleRequest=0;
  private historyPanel!:UIKitMLAsset;
  private historyText!:TextSurface;
  private selectedId='asha';
  private language:Language='en';
  private entered=false;
  private elapsed=0;
  private playback=0;
  private step=0;
  private historyPage=0;
  private settingsOpen=false;
  private historyOpen=false;
  private suspended=false;

  init():void {
    this.toolbar=this.world.requireSceneObject<UIKitMLAsset>('toolbar');this.toolbarRestY=this.toolbar.position.y;
    this.historyPanel=this.world.requireSceneObject<UIKitMLAsset>('history');
    this.historyText=new TextSurface(548,2400);
    this.historyPanel.requireElementById('history-area').add(this.historyText.image);
    this.cleanupFuncs.push(()=>this.historyText.dispose());
    this.engine=new SpatialCaptionEngine(this.world,this.captions,this.preferences,this.cleanupFuncs,id=>{this.selectedId=id;this.refresh();});
    this.speech=new SpeechSession({receive:event=>this.receive(event)},()=>this.refresh(),()=>this.captionDestination());
    this.sign=new SignSession({receive:event=>this.receive(event)},()=>this.refresh(),()=>this.captionDestination());
    this.ar=new ArViewport(this.captions,this.recipients,this.speech,this.sign,this.preferences,{
      leave:()=>this.leaveAr(),
      mode:mode=>{if(this.ar?.mode!==mode)this.changeArInput(mode);},
      speech:()=>this.toggleSpeech(),
      readSample:file=>this.readSpeechSample(file),
    });
    this.cleanupFuncs.push(()=>this.ar?.dispose());
    this.previewTexture=new VideoTexture(this.sign.camera.video);this.previewTexture.colorSpace=SRGBColorSpace;
    this.previewImage=createPreview(this.previewTexture);
    this.toolbar.requireElementById('sign-video').add(this.previewImage);
    this.cleanupFuncs.push(()=>{this.sign.dispose();this.speech.dispose();this.previewImage.dispose();this.previewTexture.dispose();});
    const entry=this.world.requireSceneObject<UIKitMLAsset>('entry');
    const settings=this.settingsPanel=this.world.requireSceneObject<UIKitMLAsset>('settings');
    this.toolbar.visible=false;settings.visible=false;this.historyPanel.visible=false;
    const enterExperience=(guided=false)=>{
      entry.visible=false;
      this.entered=true;
      this.toolbar.visible=true;
      if(guided)this.startGuide();else this.send('asha');
    };
    this.bind(entry,'enter',()=>enterExperience(true));
    this.bind(entry,'skip-intro',()=>enterExperience());
    this.bind(entry,'entry-ar',()=>this.enterAr());
    this.bind(settings,'real-world-ar',()=>this.enterAr());
    for(const s of speakers){
      const identity=this.world.requireSceneObject<UIKitMLAsset>('identity-'+s.id);
      identity.requireElementById('name').setProperties({text:s.name});
      identity.requireElementById('language').setProperties({text:`${s.language} | demo person`});
      this.bind(identity,'name',()=>this.selectSpeaker(s.id));
    }
    this.bind(this.toolbar,'speaker-select',()=>{const ids=['asha','lucia','alex','neutral'];this.selectSpeaker(ids[(ids.indexOf(this.selectedId)+1)%ids.length]);});
    this.bind(this.toolbar,'demo-mode',()=>this.setInputMode('demo'));
    this.bind(this.toolbar,'mode',()=>this.setInputMode('speech'));
    this.bind(this.toolbar,'tour',()=>{if(this.guideStep>=0)this.finishGuide();else this.startGuide();});
    this.bind(this.toolbar,'demo-language',()=>this.cycleDemoLanguage());
    this.bind(this.toolbar,'sign-mode',()=>this.setInputMode('sign'));
    this.bind(this.toolbar,'sign-start',()=>{if(this.sign.active)this.sign.stop();else void this.sign.start();});
    this.bind(settings,'sign-camera',()=>this.sign.cycleCamera());
    this.bind(settings,'sign-preview',()=>{this.preview=!this.preview;this.refresh();});
    this.bind(this.toolbar,'sign-confirm',()=>{this.sign.confirm();});
    this.bind(this.toolbar,'sign-dismiss',()=>this.sign.dismiss());
    this.bind(settings,'sign-auto',()=>this.sign.toggleAuto());
    this.bind(settings,'sign-diagnostics-toggle',()=>{this.showSignDiagnostics=!this.showSignDiagnostics;this.refresh();});
    this.bind(this.toolbar,'sign-reference',()=>{
      if(this.sign.active || this.sign.state==='starting' || this.sign.state==='recognizing')return;
      void this.sign.replay(0,true);
    });
    for(let i=0;i<3;i++)this.bind(this.toolbar,'sign-candidate-'+i,()=>this.sign.choose(i));
    this.bind(this.toolbar,'listen',()=>this.toggleSpeech());
    this.bind(this.toolbar,'input',()=>{const languages=['auto','en','hi','es'] as const;this.speech.configure({language:languages[(languages.indexOf(this.speech.options.language)+1)%4]});this.refresh();});
    this.bind(this.toolbar,'output',()=>{this.speech.configure({output:this.speech.options.output==='english'?'original':'english'});this.refresh();});
    this.bind(settings,'model',()=>{this.speech.configure({model:this.speech.options.model==='tiny'?'base':'tiny'});this.refresh();});
    this.bind(settings,'backend',()=>{const backends=['auto','wasm','webgpu'] as const;this.speech.configure({backend:backends[(backends.indexOf(this.speech.options.backend)+1)%3]});this.refresh();});
    this.bind(settings,'load-model',()=>{if(this.inputMode==='sign')return;if(this.speech.busy)this.speech.unload();else void this.speech.load();});
    for(const lang of ['en','hi','es'] as const)this.bind(settings,lang,()=>this.setLanguage(lang));
    this.bind(settings,'size',()=>{this.preferences.size=this.preferences.size===24?29:this.preferences.size===29?20:24;this.refresh();});
    this.bind(settings,'pause',()=>this.pause());
    this.bind(this.toolbar,'next',()=>this.next());
    this.bind(settings,'scenario',()=>this.setScene(scenes[(scenes.indexOf(this.demo.scene)+1)%scenes.length]));
    this.bind(settings,'reset',()=>this.reset());
    const xr=()=>{if(this.world.visibilityState.value===VisibilityState.NonImmersive)void this.world.launchXR();else this.world.exitXR();};
    this.bind(settings,'xr',xr);
    const fileDialog=this.fileDialog=document.createElement('dialog');
    fileDialog.className='speech-file';
    fileDialog.setAttribute('aria-labelledby','speech-file-title');
    fileDialog.innerHTML=`
      <form method="dialog">
        <h2 id="speech-file-title">Use audio file</h2>
        <p>Select a short speech recording for on-device recognition.</p>
        <label>Audio file <input type="file" accept="audio/*,.wav"></label>
        <button value="cancel">Cancel</button>
      </form>`;
    document.body.append(fileDialog);
    const audioFile=fileDialog.querySelector('input')!;
    const onAudioFile=()=>{
      const selected=audioFile.files?.[0];
      audioFile.value='';
      if(!selected)return;
      fileDialog.close();
      void this.readSpeechSample(selected);
    };
    audioFile.addEventListener('change',onAudioFile);
    this.cleanupFuncs.push(()=>{this.sampleRequest++;audioFile.removeEventListener('change',onAudioFile);fileDialog.remove();});
    const chooseAudioFile=()=>{
      if(this.speech.active||this.speech.busy||!this.speech.recognizer.ready||fileDialog.open)return;
      fileDialog.showModal();
    };
    this.bind(settings,'speech-sample',chooseAudioFile);
    this.bind(settings,'diagnostics',()=>{this.diagnosticsOpen=!this.diagnosticsOpen;this.refresh();});
    this.bind(this.toolbar,'settings',()=>{this.historyOpen=false;this.settingsOpen=!this.settingsOpen;this.refresh();});
    this.bind(this.toolbar,'history',()=>{this.settingsOpen=false;this.historyOpen=!this.historyOpen;this.refresh();});
    this.bind(settings,'contrast',()=>{this.preferences.contrast=!this.preferences.contrast;this.refresh();});
    this.bind(settings,'motion',()=>{this.preferences.reducedMotion=!this.preferences.reducedMotion;this.refresh();});
    this.bind(settings,'close-settings',()=>{this.settingsOpen=false;this.refresh();});
    this.bind(settings,'clear',()=>this.clear());
    this.bind(this.historyPanel,'older',()=>{this.historyPage=Math.min(this.historyPage+1,this.captions.history.length-1);this.refresh();});
    this.bind(this.historyPanel,'newer',()=>{this.historyPage=Math.max(this.historyPage-1,0);this.refresh();});
    this.bind(this.historyPanel,'clear-history',()=>this.clear());
    this.bind(this.historyPanel,'close-history',()=>{this.historyOpen=false;this.refresh();});
    this.cleanupFuncs.push(this.queries.selected.subscribe('qualify',e=>this.selectSpeaker(e.getValue(Speaker,'speakerId')??'neutral')));
    const keyboard=(e:KeyboardEvent)=>{
      if(e.repeat||fileDialog.open||this.ar?.visible||e.ctrlKey||e.metaKey||e.altKey)return;
      if(e.key.toLowerCase()==='w'){this.enterAr();return;}
      if(!this.entered){if(e.key==='Enter')enterExperience(true);if(e.key==='Escape')enterExperience();return;}
      if(['1','2','3'].includes(e.key))this.selectSpeaker(speakers[Number(e.key)-1].id);
      if(e.code==='Space'){e.preventDefault();this.pause();}
      if(e.key.toLowerCase()==='n')this.next();
      if(e.key.toLowerCase()==='p'){this.captions.pin(this.selectedId);this.refresh();}
      if(e.key.toLowerCase()==='r')this.reset();
      const key=e.key.toLowerCase();
      if(key==='e'){this.captions.expand(this.selectedId);this.refresh();}
      if(this.inputMode==='demo'){
        if(key==='c')this.setScene(scenes[(scenes.indexOf(this.demo.scene)+1)%scenes.length]);
        if(key==='d')this.cycleDemoLanguage();
      }
      if(key==='h'){this.settingsOpen=false;this.historyOpen=!this.historyOpen;this.refresh();}
      if(key==='g'){this.historyOpen=false;this.settingsOpen=!this.settingsOpen;this.refresh();}
      if(key==='t'){this.preferences.size=this.preferences.size===24?29:this.preferences.size===29?20:24;this.refresh();}
      if(key==='b'){this.preferences.contrast=!this.preferences.contrast;this.refresh();}
      if(key==='u'){this.preferences.reducedMotion=!this.preferences.reducedMotion;this.refresh();}
      if(this.historyOpen&&key==='j'){this.historyPage=Math.min(this.historyPage+1,this.captions.history.length-1);this.refresh();}
      if(this.historyOpen&&key==='k'){this.historyPage=Math.max(this.historyPage-1,0);this.refresh();}
      if(e.key==='Delete')this.clear();
      if(key==='x'){if(this.world.visibilityState.value===VisibilityState.NonImmersive)void this.world.launchXR();else this.world.exitXR();}
      if(this.inputMode==='speech'){
        if(key==='f'){if(e.shiftKey)this.speech.configure({model:this.speech.options.model==='tiny'?'base':'tiny'});else if(this.speech.busy)this.speech.unload();else void this.speech.load();}
        if(key==='i'){const languages=['auto','en','hi','es'] as const;this.speech.configure({language:languages[(languages.indexOf(this.speech.options.language)+1)%4]});this.refresh();}
        if(key==='o'){if(e.shiftKey){const backends=['auto','wasm','webgpu'] as const;this.speech.configure({backend:backends[(backends.indexOf(this.speech.options.backend)+1)%3]});}else this.speech.configure({output:this.speech.options.output==='english'?'original':'english'});this.refresh();}
      }
      if(e.key.toLowerCase()==='m')this.setInputMode(this.inputMode==='demo'?'speech':this.inputMode==='speech'?'sign':'demo');
      if(e.key==='0'){this.selectedId='neutral';this.refresh();}
      if(this.inputMode==='speech'&&key==='l'){
        if(e.shiftKey)chooseAudioFile();
        else this.toggleSpeech();
      }
      if(this.inputMode==='sign'){
        if(key==='y'&&!this.sign.active&&this.sign.state!=='starting'&&this.sign.state!=='recognizing')void this.sign.replay(0,true);
        if(e.key.toLowerCase()==='s'){if(this.sign.active)this.sign.stop();else void this.sign.start();}
        if(e.key.toLowerCase()==='c')this.sign.cycleCamera();
        if(e.key.toLowerCase()==='v'){this.preview=!this.preview;this.refresh();}
        if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();this.sign.choose((this.sign.selected+(e.key==='ArrowRight'?1:2))%3);}
        if(e.key==='Enter')this.sign.confirm();
        if(e.key==='Backspace'){e.preventDefault();this.sign.dismiss();}
        if(e.key.toLowerCase()==='a')this.sign.toggleAuto();
      }
      if(e.key==='Escape'){this.historyOpen=false;this.settingsOpen=false;this.refresh();}
    };
    window.addEventListener('keydown',keyboard);this.cleanupFuncs.push(()=>window.removeEventListener('keydown',keyboard));
    const visibility=()=>{this.suspended=document.hidden;if(document.hidden){this.sampleRequest++;this.ar?.tracking.stop();this.speech.stop();this.sign.stop();}};document.addEventListener('visibilitychange',visibility);
    this.cleanupFuncs.push(()=>document.removeEventListener('visibilitychange',visibility));
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(v=>{this.suspended=v===VisibilityState.VisibleBlurred||document.hidden;
      if(v===VisibilityState.VisibleBlurred){this.sampleRequest++;this.speech.stop();this.sign.stop();}
      const immersive=v!==VisibilityState.NonImmersive;
      if(immersive&&this.ar?.visible)this.leaveAr();
      if(this.wasImmersive!==immersive)this.sign.stop();
      if(this.wasImmersive!==immersive){this.sampleRequest++;this.speech.stop();}this.wasImmersive=immersive;
      entry.requireElementById('entry-ar').setProperties({display:immersive?'none':'flex'});
      settings.requireElementById('real-world-ar').setProperties({display:immersive?'none':'flex'});
      settings.requireElementById('xr-label').setProperties({text:immersive?'Exit XR':'Enter XR'});
      // The authored fallback is never physical passthrough geometry.
      const session=this.world.renderer.xr.getSession();
      const lounge=!session || session.environmentBlendMode==='opaque' ||
        (import.meta.env.DEV && navigator.userAgent.includes('Quest 3)'));
      this.world.requireSceneObject('demo-room').visible=lounge;
      this.world.requireSceneObject('masthead').visible=lounge;
    }));
    this.refresh();
    this.enterAr();
    // Read-only observability for managed-browser verification and future adapter wiring.
    const api={arSnapshot:()=>this.ar?.snapshot(),signSnapshot:()=>this.sign.snapshot(),recognizeSignReplay:(index:number)=>{if(!import.meta.env.DEV)throw Error('Reference replay is a development diagnostic.');return this.sign.replay(index);},receive:(event:CaptionEvent)=>this.receive(event),recognizeFixture:(audio:Float32Array,rate:number)=>this.speech.recognizeFixture(audio,rate),speechSnapshot:()=>({live:this.speech.live,active:this.speech.active,recording:this.speech.recording,busy:this.speech.busy,options:{...this.speech.options},state:{...this.speech.state},backend:this.speech.recognizer.backend,metrics:this.speech.recognizer.metrics,lastResult:this.speech.lastResult,droppedSegments:this.speech.droppedSegments}),snapshot:()=>({entered:this.entered,guideStep:this.guideStep,guideMessage:this.guideMessage,settingsOpen:this.settingsOpen,historyOpen:this.historyOpen,inputMode:this.inputMode,selectedSpeaker:this.selectedId,language:this.language,scene:this.demo.scene,paused:this.captions.paused,preferences:{...this.preferences},historyCount:this.captions.history.length,captions:[...this.captions.active.values()].map(r=>({...r,event:{...r.event}}))})};
    if(import.meta.env.DEV)Object.defineProperty(window,'betweenUs',{value:api,configurable:true});
    else Object.defineProperty(window,'betweenUs',{value:{snapshot:api.snapshot,arSnapshot:api.arSnapshot,signSnapshot:api.signSnapshot,speechSnapshot:api.speechSnapshot},configurable:true});
    this.cleanupFuncs.push(()=>{delete (window as Window & {betweenUs?:unknown}).betweenUs;});
  }
  private bind(panel:UIKitMLAsset,id:string,fn:()=>void):void {
    const el=panel.requireElementById(id);el.name=id;el.addEventListener('click',fn);
    this.cleanupFuncs.push(()=>el.removeEventListener('click',fn));
  }
  private captionDestination():string|undefined {
    if(this.ar?.visible)return this.ar.captionAnchor();
    return this.selectedId==='neutral'?undefined:this.selectedId;
  }
  receive(event:CaptionEvent):boolean {
    if(this.ar?.visible){
      if(event.provenance==='predefined-demo')return false;
      // Honor the destination snapshotted at capture, and never transfer late
      // output to a newly detected person.
      const destination=this.ar.captionAnchor();
      const referenceReplay=event.inference?.runtime==='local-gesturesign'&&event.inference.input==='reference-replay';
      const speakerId=destination===event.speakerId&&!referenceReplay?destination:undefined;
      event={...event,speakerId,
        inference:event.inference?{...event.inference,association:speakerId?'camera-track':'neutral'}:undefined};
    }
    const accepted=this.captions.receive(event);
    if(accepted)this.refresh();
    return accepted;
  }
  private enterAr():void {
    if(!this.ar || this.ar.visible || this.world.visibilityState.value!==VisibilityState.NonImmersive)return;
    this.stopInputs();
    this.captions.clear();
    this.captions.paused=false;
    this.engine.refresh();
    document.getElementById('scene-container')?.setAttribute('inert','');
    this.ar.open();
    this.changeArInput('speech');
  }
  private changeArInput(mode:'speech'|'sign'):void {
    if(!this.ar?.visible)return;
    if(this.ar.mode!==mode){
      this.stopInputs();
      if(mode==='sign')this.speech.unload();
    }
    this.ar.mode=mode;
    this.speech.setMode(mode==='speech');
    this.sign.setEnabled(mode==='sign');
    this.refresh();
  }
  private leaveAr():void {
    if(!this.ar?.visible)return;
    this.stopInputs();
    this.ar.close();
    document.getElementById('scene-container')?.removeAttribute('inert');
    this.captions.clear();
    this.selectedId='asha';
    this.inputMode='demo';
    this.finishGuide();
    if(this.entered)this.send('asha');
    this.refresh();
  }
  private stopInputs():void {
    this.sampleRequest++;
    this.sampleError='';
    this.fileDialog?.close();
    this.speech.setMode(false);
    this.sign.setEnabled(false);
  }
  private send(id:string):void {if(this.inputMode!=='demo')return;this.receive(this.demo.make(id,this.language));}
  private selectSpeaker(id:string):void {if(this.guideStep>=0)this.finishGuide();this.selectedId=id;this.playback=0;this.send(id);this.refresh();}
  private cycleDemoLanguage():void {
    const languages:Language[]=['en','hi','es'];
    this.setLanguage(languages[(languages.indexOf(this.language)+1)%languages.length]);
  }
  private async readSpeechSample(file:File):Promise<void> {
    if(!this.speech.live||this.speech.active||this.speech.busy||!this.speech.recognizer.ready)return;
    const request=++this.sampleRequest;
    let context:AudioContext|undefined;
    this.sampleError='';
    this.settingsOpen=false;
    try{
      if(file.size>12_000_000)throw new Error('Choose a short audio file under 12 MB.');
      context=new AudioContext({sampleRate:16000});
      const decoded=await context.decodeAudioData(await file.arrayBuffer());
      if(decoded.duration>25)throw new Error('Choose a speech clip under 25 seconds.');
      if(request!==this.sampleRequest||document.hidden||!this.speech.live)return;
      await this.speech.recognizeFixture(decoded.getChannelData(0),decoded.sampleRate);
    }catch(error){
      if(request===this.sampleRequest){
        this.sampleError=error instanceof Error?error.message:'Could not read this audio clip.';
        this.refresh();
      }
    }finally{
      await context?.close();
    }
  }
  private toggleSpeech():void {
    this.sampleRequest++;
    this.sampleError='';
    if(this.speech.active)this.speech.stop();
    else if(this.speech.busy){
      if(!this.speech.recognizer.ready)this.speech.unload();
    }else if(!this.speech.recognizer.ready)void this.speech.load();
    else void this.speech.start();
  }
  private startGuide():void {
    this.guideStep=0;
    this.captions.clear();
    this.captions.paused=false;
    this.demo.scene='alternating';
    this.showGuideStep();
  }
  private showGuideStep():void {
    const step=guidedSteps[this.guideStep];
    this.selectedId=step.speaker;
    this.language=step.language;
    this.guideMessage=step.message;
    this.playback=0;
    this.send(step.speaker);
  }
  private finishGuide():void {
    this.guideStep=-1;
    this.guideMessage='';
    this.playback=0;
    this.refresh();
  }
  private setLanguage(lang:Language):void {
    if(this.inputMode!=='demo'){if(lang==='en')this.speech.configure({output:'english'});return;}
    if(this.guideStep>=0)this.finishGuide();
    this.language=lang;
    // Only predefined samples can be substituted locally. Model text awaits a real translator.
    for(const r of this.captions.active.values())if(r.event.provenance==='predefined-demo')this.captions.receive(this.demo.translate(r.event,lang));
    this.refresh();
  }
  private setInputMode(mode:'demo'|'speech'|'sign'):void {
    if(mode===this.inputMode)return;
    this.finishGuide();
    this.fileDialog?.close();
    this.sampleRequest++;this.sampleError='';
    this.settingsOpen=false;this.historyOpen=false;this.diagnosticsOpen=false;
    this.sign.setEnabled(false);this.speech.setMode(false);
    if(mode==='sign')this.speech.unload();
    this.inputMode=mode;this.speech.setMode(mode==='speech');this.sign.setEnabled(mode==='sign');
    this.captions.clear();this.captions.paused=false;this.playback=0;this.preview=false;
    this.language='en';this.selectedId=mode==='demo'?'asha':'neutral';
    if(mode==='demo')this.send('asha');this.refresh();
  }
  private pause():void {this.sampleRequest++;this.sign.stop();if(this.speech.live)this.speech.stop();this.captions.paused=!this.captions.paused;this.captions.tick(0);this.refresh();}
  private clear():void {this.sampleRequest++;if(this.guideStep>=0)this.finishGuide();this.sign.stop();if(this.speech.live)this.speech.stop();this.captions.clear();this.historyPage=0;this.playback=0;this.refresh();}
  private setScene(scene:DemoScene):void {
    if(this.inputMode!=='demo')return;
    this.demo.scene=scene;this.clear();this.step=0;this.selectedId='asha';this.send('asha');
    if(scene==='pinned')this.captions.pin('asha');
    if(scene==='alternating'||scene==='switching'){this.send('lucia');this.send('alex');}
    this.refresh();
  }
  private next():void {
    if(this.inputMode!=='demo')return;
    if(this.guideStep>=0){
      this.guideStep++;
      if(this.guideStep<guidedSteps.length)this.showGuideStep();
      else this.finishGuide();
      return;
    }
    const id=['single','long','pinned','uncertain','unknown'].includes(this.demo.scene)?this.selectedId:speakers[(++this.step)%3].id;
    if(this.demo.scene==='switching')this.selectedId=id;
    this.send(id);this.playback=0;this.refresh();
  }
  private reset():void {
    this.sampleRequest++;this.finishGuide();this.sign.stop();this.speech.stop();this.captions.clear();
    this.captions.paused=false;this.settingsOpen=false;this.historyOpen=false;
    this.language='en';this.preferences.size=24;this.preferences.contrast=false;
    this.preferences.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.elapsed=0;if(this.inputMode==='demo')this.setScene('alternating');this.refresh();
  }
  private refresh():void {
    if(this.ar?.visible){this.captions.tick(0);this.ar.refresh(this.sampleError);return;}
    this.captions.tick(0);this.engine.refresh();
    if(!this.speech||!this.sign||!this.previewImage)return;
    const live=this.inputMode!=='demo';const signing=this.inputMode==='sign';
    const settings=this.settingsPanel;
    const speechMode=this.inputMode==='speech';
    const tool=(id:string)=>this.toolbar.requireElementById(id);
    const option=(id:string)=>settings.requireElementById(id);
    const languageNames={en:'English',hi:'Hindi',es:'Spanish',auto:'Auto'};
    this.toolbar.position.y=this.toolbarRestY+(signing&&(this.sign.pending||this.preview&&this.sign.camera.active)?0.18:0);
    this.world.requireSceneObject<UIKitMLAsset>('masthead').requireElementById('room-mode')
      .setProperties({text:'THE CONVERSATION LOUNGE'});
    this.historyPanel.requireElementById('history-mode').setProperties({text:'CONVERSATION NOTES'});
    for(const [id, mode] of [['demo-mode','demo'],['mode','speech'],['sign-mode','sign']] as const){
      const selected=this.inputMode===mode;
      tool(id).setProperties({backgroundColor:selected?'#d8e1f0':'#e6eae9',borderColor:selected?'#56658f':'#c3d2cf'});
    }
    tool('demo-controls').setProperties({display:live?'none':'flex'});
    tool('live-controls').setProperties({display:speechMode?'flex':'none'});
    const speech=this.speech;
    const progress=speech.state.progress;
    const progressText=speech.state.state==='downloading'&&progress!==undefined?` (${Math.round(progress)}%)`:'';
    tool('speech-status').setProperties({display:speechMode?'flex':'none',
      text:(this.sampleError||speech.state.message)+progressText+(speech.state.state==='processing'?' | Usually 5-13 seconds.':''),
      color:speech.state.state==='error'?'#8a3526':'#274b48'});
    const listenAction=speech.active?'Stop listening':speech.busy&&!speech.recognizer.ready?'Cancel preparation':
      speech.recognizer.ready?'Start listening':'Prepare speech';
    tool('listen-label').setProperties({text:listenAction});
    tool('listen').setProperties({backgroundColor:speech.active?'#8a4939':'#24685c'});
    tool('input-label').setProperties({text:`Input: ${languageNames[speech.options.language]}`});
    tool('output-label').setProperties({text:speech.options.output==='english'?'Output: English':'Output: Original'});
    tool('demo-language-label').setProperties({text:`Output: ${languageNames[this.language]}`});
    tool('tour-label').setProperties({text:this.guideStep>=0?'Skip guide':'Guided demo'});
    tool('privacy').setProperties({text:signing?'Isolated ASL to English. Camera stays on this device.':
      speechMode?'Audio stays on this device. Assign a speaker manually.':
      this.guideMessage?'Predefined demo | '+this.guideMessage:'Predefined examples | Select a person to place their caption.'});
    this.engine.setProcessing(speechMode&&speech.state.state==='processing'?speech.processingSpeaker:
      signing&&this.sign.state==='recognizing'?this.selectedId:undefined);
    const name=speakers.find(s=>s.id===this.selectedId)?.name??'Unassigned';
    tool('active').setProperties({text:`Assign: ${name}`});
    option('pause-label').setProperties({text:this.captions.paused?'Resume':'Pause'});
    option('size-label').setProperties({text:`Text: ${this.preferences.size===20?'S':this.preferences.size===24?'M':'L'}`});
    option('scenario-label').setProperties({text:`Scene: ${this.demo.scene}`});
    for(const lang of ['en','hi','es']){
      option(lang).setProperties({borderColor:lang===this.language?'#246d62':'#b8cec4',borderWidth:lang===this.language?3:1});
    }
    this.refreshSign();
    settings.visible=this.settingsOpen;
    option('demo-options').setProperties({display:live?'none':'flex'});
    option('sign-options').setProperties({display:signing?'flex':'none'});
    option('speech-sample').setProperties({display:speechMode&&speech.recognizer.ready&&!speech.active&&!speech.busy?'flex':'none'});
    option('diagnostics').setProperties({display:speechMode?'flex':'none'});
    option('speech-diagnostics').setProperties({display:speechMode&&this.diagnosticsOpen?'flex':'none'});
    option('settings-note').setProperties({text:signing?'Reference clips use dataset landmarks. Camera input requires a browser webcam.':
      speechMode?'English translation or original transcription. Hindi and Spanish output require Original.':
      'Demo changes the language of predefined examples.'});
    option('model-label').setProperties({text:`Model: ${speech.options.model==='tiny'?'Tiny':'Base'}`});
    option('backend-label').setProperties({text:`Backend: ${speech.options.backend==='wasm'?'CPU':speech.options.backend==='auto'?'Auto':'WebGPU'}`});
    option('load-model-label').setProperties({text:speech.busy?'Cancel / Unload':speech.recognizer.ready?'Reload model':'Load model'});
    option('model-status').setProperties({text:speech.state.message});
    const metrics=speech.recognizer.metrics;
    option('model-metrics').setProperties({text:metrics?`${speech.recognizer.backend?.toUpperCase()} | Init ${(metrics.initMs/1000).toFixed(1)} s | Models ${(metrics.downloadedBytes/1e6).toFixed(1)} MB`:'Download begins when requested.'});
    option('contrast-label').setProperties({text:`High contrast: ${this.preferences.contrast?'on':'off'}`});
    option('motion-label').setProperties({text:`Reduced motion: ${this.preferences.reducedMotion?'on':'off'}`});
    this.historyPanel.visible=this.historyOpen;
    if(this.historyOpen){
      this.historyPage=Math.max(0,Math.min(this.historyPage,this.captions.history.length-1));
      const e=this.captions.history[this.captions.history.length-1-this.historyPage];
      const history=e?`${captionSource(e)} | ${speakers.find(s=>s.id===e.speakerId)?.name??'Unknown'} | ${e.targetLanguage.toUpperCase()}\n\n${e.displayText}`:'No captions yet. Select a person to begin.';
      const h=this.historyText.draw(history,this.preferences.size,'#233e46');
      this.historyPanel.requireElementById('history-area').setProperties({height:Math.min(h,360),overflow:'scroll'});
      this.historyPanel.requireElementById('history-position').setProperties({text:e?`Caption ${this.captions.history.length-this.historyPage} of ${this.captions.history.length} | newest first`:'No captions'});
    }
    for(const e of this.queries.people.entities){
      const id=e.getValue(Speaker,'speakerId');const ring=e.object3D?.getObjectByName('SelectionRing');if(ring)ring.visible=id===this.selectedId;
      this.world.requireSceneObject<UIKitMLAsset>('identity-'+id).requireElementById('name').setProperties({text:`${id===this.selectedId?'SELECTED | ':''}${speakers.find(s=>s.id===id)?.name??id}`});
    }
  }
  private showSignDiagnostics=false;
  private refreshSign():void {
    const sign=this.sign,visible=this.inputMode==='sign';
    this.toolbar.requireElementById('sign-panel').setProperties({display:visible?'flex':'none'});
    this.settingsPanel.requireElementById('sign-diagnostics-controls').setProperties({display:visible?'flex':'none'});
    const diagnosticsOpen=visible&&this.showSignDiagnostics;
    this.settingsPanel.requireElementById('sign-diagnostic-data').setProperties({display:diagnosticsOpen?'flex':'none'});
    if(diagnosticsOpen)sign.diagnosticLines().forEach((text,index)=>{
      this.settingsPanel.requireElementById('sign-diagnostic-line-'+index).setProperties({text});
    });
    if(!visible)return;
    this.toolbar.requireElementById('sign-start-label').setProperties({text:sign.active?'Stop Signing':'Start Signing'});
    this.toolbar.requireElementById('sign-start').setProperties({backgroundColor:sign.active?'#8a4939':'#246d62'});
    const device=sign.cameras.find(d=>d.deviceId===sign.deviceId);
    this.settingsPanel.requireElementById('sign-camera-label').setProperties({text:`Camera: ${device?.label?.slice(0,24)??(sign.cameras.length>1?'choose / '+sign.cameras.length:'default')}`});
    this.settingsPanel.requireElementById('sign-preview-label').setProperties({text:`Preview: ${this.preview?'on':'off'}`});
    this.toolbar.requireElementById('sign-preview-area').setProperties({display:this.preview&&sign.camera.active?'flex':'none'});
    this.toolbar.requireElementById('sign-status').setProperties({text:`${sign.camera.active?'CAMERA ON | ':''}${sign.message}`,fontSize:this.preferences.size===29?26:22});
    this.toolbar.requireElementById('sign-reference').setProperties({display:sign.active?'none':'flex'});
    this.toolbar.requireElementById('sign-review').setProperties({display:sign.pending?'flex':'none'});
    const prediction=sign.pending;
    const assigned=speakers.find(s=>s.id===prediction?.speakerId)?.name??'Unassigned';
    this.toolbar.requireElementById('sign-detail').setProperties({
      display:prediction?'flex':'none',
      text:prediction?.input==='reference-replay'?
        `Reference clip | For ${assigned} | Google ISLR, CC BY 4.0`:`For ${assigned}`,
    });
    this.toolbar.requireElementById('sign-candidates').setProperties({display:sign.pending?'flex':'none'});
    for(let i=0;i<3;i++){
      const c=sign.pending?.candidates[i];this.toolbar.requireElementById('sign-candidate-label-'+i).setProperties({text:c?c.label:'-'});
      this.toolbar.requireElementById('sign-candidate-'+i).setProperties({borderWidth:i===sign.selected?3:1,borderColor:i===sign.selected?'#246d62':'#b8cec4'});
    }
    for(const id of ['sign-confirm','sign-dismiss'])this.toolbar.requireElementById(id).setProperties({display:sign.pending?'flex':'none'});
    this.settingsPanel.requireElementById('sign-auto-label').setProperties({text:sign.autoDisplay?'Auto confirm: on':'Auto confirm: off'});
    this.toolbar.requireElementById('sign-status').setProperties({color:sign.state==='not-sure'?'#805313':sign.state==='unavailable'?'#8a3526':'#233e46'});
  }
  update(delta:number):void {
    if(this.suspended)return;
    if(this.ar?.visible){this.captions.tick(delta);return;}
    const dt=Math.min(delta,.1);
    if(!this.captions.paused){
      this.elapsed+=dt;
      if(this.entered){
        this.playback+=dt;
        if(this.inputMode==='demo'&&this.playback>(this.guideStep>=0?4.2:6.5))this.next();
      }
    }
    for(const e of this.queries.people.entities){
      const o=e.object3D;if(!o)continue;const phase=e.getValue(Speaker,'phase')??0;const id=e.getValue(Speaker,'speakerId');const s=speakers.find(s=>s.id===id)!;
      const targetX=s.x+(this.demo.scene==='moving'&&id==='asha'&&!this.preferences.reducedMotion?Math.sin(this.elapsed*.65)*.45:0);
      o.position.x+=(targetX-o.position.x)*(this.preferences.reducedMotion?1:1-Math.exp(-dt*5));
      o.position.y=this.preferences.reducedMotion?0:Math.sin(this.elapsed*1.4+phase)*.012;
      const arm=o.getObjectByName('RightArm');if(arm)arm.rotation.z=.12+(this.preferences.reducedMotion?0:Math.sin(this.elapsed*.9+phase)*.04);
      const head=o.getObjectByName('HeadMotion');
      const torso=o.getObjectByName('Torso');
      const record=id?this.captions.active.get(id):undefined;
      const nod=record&&record.age<0.8&&this.entered&&!record.pinned?Math.sin(record.age/0.8*Math.PI)*0.055:0;
      if(head){
        head.rotation.z=this.preferences.reducedMotion?0:Math.sin(this.elapsed*.6+phase)*.024;
        head.rotation.y=this.preferences.reducedMotion?0:Math.sin(this.elapsed*.45+phase)*.08;
        head.rotation.x=this.preferences.reducedMotion?0:nod;
      }
      if(torso)torso.scale.y=0.34+(this.preferences.reducedMotion?0:Math.sin(this.elapsed*1.5+phase)*0.011);
      const hover=this.queries.hovered.entities.has(e);
      const selected=id===this.selectedId;
      const scale=hover?1.022:selected?1.009:1;
      o.scale.setScalar(this.preferences.reducedMotion?scale:o.scale.x+(scale-o.scale.x)*(1-Math.exp(-dt*8)));
    }
    if(this.captions.tick(dt))this.engine.refresh();
    this.engine.update(dt);
  }
}
