import { captionSource, type ReadingPreferences } from '../captions/spatial-engine';
import type { CaptionCoordinator } from '../captions/coordinator';
import type { CaptionRecord } from '../captions/contracts';
import type { SpeechSession } from '../speech/session';
import type { SignSession } from '../sign/session';
import type { TrackerFrame } from '../sign/vendor/tracker-client';
import { CameraTracking } from './camera-tracking';
import { captionPosition, containVideo, projectPoint } from './person-anchor';
import './viewport.css';

const labels = {en:'English',hi:'Hindi',es:'Spanish',ase:'ASL',und:'Auto'};
type Input = 'speech' | 'sign';

export interface ArActions {
  leave(): void;
  mode(mode: Input): void;
  speech(): void;
  readSample(file:File): Promise<void>;
}

export class ArViewport {
  readonly tracking: CameraTracking;
  visible = false;
  mode: Input = 'speech';
  private id?: string;
  private selected?: string;
  private mirror = true;
  private hadFreshTrack = false;
  private bubbleKey = '';
  private destination = 'neutral';
  private readonly root = document.createElement('section');
  private readonly stage: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly bubble: HTMLElement;
  private readonly dock: HTMLElement;
  private readonly marker: HTMLButtonElement;
  private readonly resize: ResizeObserver;
  private raf?: number;

  constructor(private readonly captions:CaptionCoordinator, private readonly recipients:Set<string>,
    private readonly speech:SpeechSession, private readonly sign:SignSession,
    private readonly preferences:ReadingPreferences, private readonly actions:ArActions) {
    this.tracking = new CameraTracking(()=>this.cameraChanged(),frame=>this.frame(frame));
    this.root.className='camera-ar';
    this.root.hidden=true;
    this.root.setAttribute('aria-label','Real-World AR');
    this.root.innerHTML=`
      <div class="ar-stage">
        <div class="ar-feed"></div>
        <header class="ar-header">
          <div class="ar-brand">
            <span class="ar-brand-mark" aria-hidden="true"></span>
            <div><h1>Between Us</h1><span>Camera AR</span></div>
          </div>
          <div class="ar-header-actions">
            <button data-ar="camera" type="button"><span class="ar-camera-icon" aria-hidden="true"></span><span data-ar="camera-label">Start camera</span></button>
            <button data-ar="lounge" type="button" aria-label="Back to lounge"><span aria-hidden="true">↗</span><span>Lounge</span></button>
          </div>
          <div class="ar-scene-status">
            <span class="ar-camera-status" data-ar="camera-status" role="status">Camera off</span>
            <span data-ar="track-status" role="status" hidden></span>
          </div>
        </header>
        <div class="ar-welcome">
          <div class="ar-viewfinder" aria-hidden="true"><i></i><i></i><i></i><i></i><span class="ar-camera-icon"></span></div>
          <h2>Camera is off</h2>
          <p>Frame one person’s face and hands for captions. Camera video stays on this device.</p>
          <button data-ar="welcome-start" class="ar-primary" type="button">Start camera <span aria-hidden="true">→</span></button>
        </div>
        <button class="ar-marker" type="button" hidden aria-label="Select tracked person"><span aria-hidden="true"></span></button>
        <article class="ar-bubble" hidden>
          <div class="ar-bubble-meta"><strong data-ar="bubble-to"></strong><span data-ar="bubble-state"></span></div>
          <p data-ar="bubble-text" aria-live="polite" tabindex="0"></p>
          <div class="ar-bubble-meta"><span data-ar="bubble-source"></span><button data-ar="pin" type="button">Pin</button></div>
        </article>
        <div class="ar-chrome">
          <div class="ar-dock"></div>
          <section class="ar-review ar-glass" data-ar="candidates" aria-label="Review sign prediction" hidden>
            <div class="ar-review-head"><strong data-ar="review-title"></strong><span data-ar="review-source"></span></div>
            <div data-ar="choices" class="ar-row" aria-label="Sign candidates"></div>
            <div class="ar-review-actions">
              <button data-ar="dismiss" type="button">Dismiss</button>
              <button data-ar="confirm" class="ar-primary" type="button">Confirm</button>
            </div>
          </section>
          <div class="ar-toolbar ar-glass" role="group" aria-label="Recognition controls">
            <div class="ar-tabs" role="group" aria-label="Communication mode">
              <button data-ar="speech-mode" type="button">Speech</button>
              <button data-ar="sign-mode" type="button">Sign</button>
            </div>
            <button data-ar="speech" class="ar-primary ar-recognition" type="button">Prepare speech</button>
            <button data-ar="sign" class="ar-primary ar-recognition" type="button" hidden>Start signing</button>
            <label class="ar-output"><span>Output</span>
              <select data-ar="output" aria-label="Output language"><option value="english">English</option><option value="original">Original</option></select>
              <strong data-ar="sign-output" hidden>English</strong>
            </label>
            <button data-ar="settings" class="ar-settings-button" type="button" aria-expanded="false" aria-controls="camera-ar-settings">
              <span class="ar-settings-icon" aria-hidden="true"></span> Settings
            </button>
            <p class="ar-input-status" data-ar="input-status" role="status"></p>
          </div>
        </div>
        <section class="ar-settings ar-glass" id="camera-ar-settings" aria-labelledby="camera-ar-settings-title" hidden>
          <header><h2 id="camera-ar-settings-title">Settings</h2><button data-ar="close-settings" type="button">Done</button></header>
          <div class="ar-settings-body">
            <div class="ar-setting-group">
              <h3>Camera</h3>
              <label class="ar-setting-field"><span>Device</span><select data-ar="devices" aria-label="Camera device"><option value="">Default</option></select></label>
              <div class="ar-setting-actions">
                <button data-ar="mirror" type="button" aria-pressed="true">Mirror</button>
                <button data-ar="fullscreen" type="button">Fullscreen</button>
              </div>
              <div class="ar-setting-actions">
                <button data-ar="person" type="button" aria-pressed="false" disabled>Select tracked person</button>
                <small data-ar="destination">Neutral captions</small>
              </div>
              <small data-ar="fullscreen-status" role="status"></small>
            </div>
            <div class="ar-setting-group" data-ar="speech-tools">
              <h3>Speech</h3>
              <label class="ar-setting-field"><span>Input language</span><select data-ar="language"><option value="auto">Auto</option><option value="en">English</option><option value="hi">Hindi</option><option value="es">Spanish</option></select></label>
              <p data-ar="model-status"></p>
              <div class="ar-setting-actions ar-setting-actions-model">
                <button data-ar="speech-model" type="button">Load speech model</button>
                <label class="ar-file" data-ar="file-label" hidden>Use audio file<input data-ar="file" type="file" aria-label="Use audio file" accept="audio/*,.wav"></label>
              </div>
            </div>
            <details class="ar-setting-group" data-ar="sign-diagnostics" hidden>
              <summary>Sign diagnostics</summary>
              <p data-ar="sign-model-status"></p>
              <p class="ar-diagnostic" data-ar="sign-diagnostic-text"></p>
            </details>
            <div class="ar-setting-group">
              <h3>Captions</h3>
              <div class="ar-setting-actions ar-setting-actions-captions">
                <button data-ar="size" type="button">Text size</button>
                <button data-ar="contrast" type="button">High contrast</button>
                <button data-ar="motion" type="button">Reduced motion</button>
              </div>
            </div>
            <details class="ar-setting-group" data-ar="reading-options">
              <summary>Caption history</summary>
              <p data-ar="empty-history">No captions yet.</p>
              <ol data-ar="history"></ol>
            </details>
          </div>
        </section>
      </div>`;
    this.stage=this.root.querySelector('.ar-stage')!;
    this.feed=this.root.querySelector('.ar-feed')!;
    this.controls=this.root.querySelector('.ar-chrome')!;
    this.bubble=this.root.querySelector('.ar-bubble')!;
    this.dock=this.root.querySelector('.ar-dock')!;
    this.marker=this.root.querySelector('.ar-marker')!;
    this.feed.append(this.tracking.camera.video);
    this.tracking.camera.video.setAttribute('aria-label','Local webcam preview');
    document.body.append(this.root);
    this.resize = new ResizeObserver(()=>this.layout());
    this.resize.observe(this.stage);
    this.resize.observe(this.controls);
    this.resize.observe(this.root.querySelector('.ar-header')!);
    this.click('lounge',()=>this.actions.leave());
    this.click('welcome-start',()=>void this.tracking.start());
    this.click('settings',()=>this.setSettings(this.get('settings').getAttribute('aria-expanded')==='false'));
    this.click('close-settings',()=>this.setSettings(false,true));
    this.click('fullscreen',()=>void this.toggleFullscreen());
    this.click('speech-model',()=>{
      if(speech.busy&&!speech.recognizer.ready)speech.unload();
      else if(!speech.recognizer.ready)void speech.load();
    });
    this.root.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&this.get('settings').getAttribute('aria-expanded')==='true'){
        event.stopPropagation();
        this.setSettings(false,true);
      }
    });
    document.addEventListener('fullscreenchange',this.fullscreenChanged);
    this.get('sign-diagnostics').addEventListener('toggle',()=>this.refresh());
    this.click('camera',()=>{
      if (this.tracking.camera.active || this.tracking.state==='starting') this.tracking.stop();
      else void this.tracking.start();
    });
    this.click('mirror',()=>{
      this.mirror=!this.mirror;
      this.refresh();
      this.position();
    });
    this.get<HTMLSelectElement>('devices').addEventListener('change',event=>{
      this.tracking.deviceId=(event.target as HTMLSelectElement).value;
      // Changing a choice never starts a new stream.
      this.tracking.stop();
    });
    this.marker.addEventListener('click',()=>this.select());
    this.click('person',()=>this.select());
    this.click('speech-mode',()=>this.actions.mode('speech'));
    this.click('sign-mode',()=>this.actions.mode('sign'));
    this.click('speech',()=>this.actions.speech());
    this.click('sign',()=>{
      if(this.sign.active) this.sign.stop();
      else if(this.tracking.state==='tracking') void this.sign.startShared();
    });
    this.get<HTMLSelectElement>('language').addEventListener('change',event=>{
      this.speech.configure({language:(event.target as HTMLSelectElement).value as SpeechSession['options']['language']});
    });
    this.get<HTMLSelectElement>('output').addEventListener('change',event=>{
      this.speech.configure({output:(event.target as HTMLSelectElement).value as SpeechSession['options']['output']});
    });
    this.get<HTMLInputElement>('file').addEventListener('change',event=>{
      const input=event.target as HTMLInputElement;
      const file=input.files?.[0];
      input.value='';
      if(file)void this.actions.readSample(file);
    });
    this.click('confirm',()=>{
      this.sign.confirm();
      this.get('sign').focus();
    });
    this.click('dismiss',()=>{
      this.sign.dismiss();
      this.get('sign').focus();
    });
    this.click('pin',()=>{this.captions.pin(this.destination);this.captions.tick(0);this.refresh();});
    this.click('size',()=>{
      this.preferences.size=this.preferences.size===24?29:this.preferences.size===29?20:24;
      this.refresh();this.position();
    });
    this.click('contrast',()=>{this.preferences.contrast=!this.preferences.contrast;this.refresh();this.position();});
    this.click('motion',()=>{this.preferences.reducedMotion=!this.preferences.reducedMotion;this.refresh();});
    this.get('reading-options').addEventListener('toggle',()=>this.refresh());
  }

  open(): void {
    this.visible=true;
    this.root.hidden=false;
    this.refresh();
    this.layout();
    this.get('welcome-start').focus();
    void this.tracking.listDevices();
    this.loop();
  }

  close(): void {
    this.visible=false;
    this.root.hidden=true;
    this.setSettings(false);
    this.get<HTMLDetailsElement>('sign-diagnostics').open=false;
    this.get<HTMLDetailsElement>('reading-options').open=false;
    if(document.fullscreenElement===this.root)void document.exitFullscreen().catch(()=>{});
    if(this.raf!==undefined)cancelAnimationFrame(this.raf);
    this.raf=undefined;
    this.tracking.stop();
    this.reconcileTrack();
  }

  dispose(): void {
    this.close();
    this.resize.disconnect();
    document.removeEventListener('fullscreenchange',this.fullscreenChanged);
    this.root.remove();
  }

  private setSettings(open: boolean, restoreFocus=false): void {
    this.get('settings').setAttribute('aria-expanded',String(open));
    this.root.querySelector<HTMLElement>('#camera-ar-settings')!.hidden=!open;
    if(open){
      this.refresh();
      this.get('close-settings').focus();
    }else if(restoreFocus)this.get('settings').focus();
  }

  private fullscreenChanged = (): void => {
    this.text('fullscreen',document.fullscreenElement===this.root?'Exit fullscreen':'Fullscreen');
    this.layout();
  };

  private async toggleFullscreen(): Promise<void> {
    this.text('fullscreen-status','');
    try {
      if(document.fullscreenElement===this.root)await document.exitFullscreen();
      else if(document.fullscreenEnabled)await this.root.requestFullscreen();
      else this.text('fullscreen-status','Fullscreen is unavailable in this window.');
    } catch {
      this.text('fullscreen-status','Fullscreen is unavailable in this window.');
    }
  }

  private layout(): void {
    if(!this.visible)return;
    const header=this.root.querySelector<HTMLElement>('.ar-header')!;
    this.stage.style.setProperty('--ar-feed-top',`${header.offsetHeight}px`);
    const bottomInset=this.stage.clientHeight-this.controls.offsetTop-this.controls.offsetHeight;
    this.stage.style.setProperty('--ar-feed-bottom',`${this.controls.offsetHeight+bottomInset+6}px`);
    this.position();
  }

  selectedPerson(): string | undefined {
    const track=this.tracking.anchors.current(performance.now());
    return track?.status==='visible' && track.id===this.selected ? this.selected : undefined;
  }

  private select(): void {
    const track=this.tracking.anchors.current(performance.now());
    if(track?.status!=='visible')return;
    this.selected=this.selected===track.id?undefined:track.id;
    this.refresh();
    this.position();
  }

  private frame(frame: TrackerFrame):void {
    this.reconcileTrack();
    if(this.mode==='sign')this.sign.pushShared(frame,this.hadFreshTrack);
  }

  private cameraChanged():void {
    if(!this.tracking.camera.active && this.visible && this.sign.active && this.mode==='sign')this.sign.stop();
    this.reconcileTrack();
    this.refresh();
  }

  private reconcileTrack():void {
    const track=this.tracking.anchors.current(performance.now());
    const fresh=track?.status==='visible';
    const changedId=this.id!==track?.id;
    const changedFresh=this.hadFreshTrack!==fresh;
    if(changedId || (this.hadFreshTrack&&!fresh)) {
      this.selected=undefined;
      this.sign.interruptShared();
    }
    if(changedId) {
      if(this.id){this.recipients.delete(this.id);this.captions.retireAnchor(this.id);}
      this.id=track?.id;
      if(this.id)this.recipients.add(this.id);
    }
    this.hadFreshTrack=fresh;
    if(changedId||changedFresh)this.refresh();
  }

  private loop = ():void => {
    if(!this.visible)return;
    this.reconcileTrack();
    this.position();
    this.raf=requestAnimationFrame(this.loop);
  };

  private position():void {
    if(!this.visible)return;
    const video=this.tracking.camera.video;
    const track=this.tracking.anchors.current(performance.now());
    this.marker.hidden=track?.status!=='visible' || !video.videoWidth || !this.tracking.camera.active;
    const active=track&&this.captions.active.get(track.id);
    const anchored=active?.state==='expired'?undefined:active;
    const neutral=this.captions.active.get('neutral');
    const showNeutral=neutral?.state==='expired'?undefined:neutral;
    const shown = showNeutral && (!anchored || showNeutral.event.timestamp > anchored.event.timestamp) ? showNeutral : anchored;
    const attached = Boolean(shown && shown===anchored);
    this.renderBubble(shown,attached,track?.status==='uncertain');
    const width=this.feed.clientWidth, height=this.feed.clientHeight;
    const top=this.feed.offsetTop;
    if(!track || !video.videoWidth || !this.tracking.camera.active || !width || !height) {
      this.dockBubble();
      return;
    }
    const rect=containVideo(width,height,video.videoWidth,video.videoHeight);
    rect.y+=top;
    const head=projectPoint(track.head,rect,this.mirror);
    const edge=projectPoint({x:track.bounds.right,y:track.head.y},rect,this.mirror);
    const opposite=projectPoint({x:track.bounds.left,y:track.head.y},rect,this.mirror);
    const right=Math.max(edge.x,opposite.x), left=Math.min(edge.x,opposite.x);
    const markerX=right+25<=width-22?right+25:Math.max(22,left-25);
    this.marker.style.left=`${markerX}px`;
    this.marker.style.top=`${Math.min(top+height-22,Math.max(top+22,head.y))}px`;
    if(!attached){this.dockBubble();return;}
    // Try the space the attached caption would have after releasing the fallback dock.
    const dockHeight=this.bubble.parentElement===this.dock?this.dock.offsetHeight+8:0;
    const captionRect=dockHeight>0?containVideo(width,height+dockHeight,video.videoWidth,video.videoHeight):rect;
    if(dockHeight>0)captionRect.y+=top;
    const maxWidth=Math.min(430,this.controls.clientWidth,Math.max(100,captionRect.width-16));
    this.bubble.style.maxWidth=`${maxWidth}px`;
    const layout=captionPosition(track.bounds,captionRect,this.mirror,this.bubble.offsetWidth,this.bubble.offsetHeight);
    if(layout){
      if(this.bubble.parentElement!==this.stage)this.stage.append(this.bubble);
      this.bubble.classList.remove('ar-docked');
      this.bubble.style.left=`${layout.x}px`;
      this.bubble.style.top=`${layout.y}px`;
    }else this.dockBubble();
  }

  private dockBubble():void {
    if(this.bubble.parentElement!==this.dock)this.dock.append(this.bubble);
    this.bubble.classList.add('ar-docked');
  }

  private renderBubble(record:CaptionRecord|undefined, anchored:boolean, uncertain=false):void {
    this.bubble.hidden=!record;
    if(!record){this.bubbleKey='';return;}
    const event=record.event;
    this.destination=record.anchorId;
    const key=[event.id,event.timestamp,event.displayText,record.pinned,record.state,anchored,uncertain].join('|');
    if(this.bubbleKey===key)return;
    this.bubbleKey=key;
    this.text('bubble-to',anchored?'Tracked person':'Neutral caption');
    const states=[];
    if(uncertain&&anchored)states.push('Tracking uncertain');
    if(event.status==='uncertain')states.push('Not sure');
    if(event.inference?.runtime==='local-gesturesign'&&event.inference.confirmed)states.push('Confirmed');
    if(record.pinned)states.push('Pinned');
    this.text('bubble-state',states.join(' · '));
    this.text('bubble-text',event.displayText);
    this.text('bubble-source',`${labels[event.sourceLanguage]} → ${labels[event.targetLanguage]} · ${captionSource(event)}`);
    this.text('pin',record.pinned?'Unpin':'Pin');
    this.press('pin',record.pinned);
  }

  refresh(sampleError=''):void {
    if(!this.visible)return;
    const {tracking,speech,sign}=this;
    const track=tracking.anchors.current(performance.now());
    const selected=Boolean(this.selectedPerson());
    const active=tracking.camera.active;
    this.root.dataset.contrast=String(this.preferences.contrast);
    this.root.dataset.motion=String(!this.preferences.reducedMotion);
    this.root.style.setProperty('--ar-text',`${this.preferences.size}px`);
    this.stage.classList.toggle('camera-on',active);
    tracking.camera.video.classList.toggle('ar-mirror',this.mirror);
    this.press('mirror',this.mirror);
    this.text('camera-label',active||tracking.state==='starting'?'Stop camera':'Start camera');
    this.root.dataset.camera=active?'on':tracking.state;
    if(document.activeElement===this.get('welcome-start')&&(active||tracking.state==='starting'))this.get('camera').focus();
    this.get<HTMLButtonElement>('welcome-start').disabled=tracking.state==='starting';
    this.text('camera-status',tracking.state==='error'?tracking.message:active?'Camera on':tracking.state==='starting'?'Starting camera…':'Camera off');
    this.get('camera-status').classList.toggle('ar-error',tracking.state==='error');
    this.get('track-status').hidden=!active;
    this.text('track-status',tracking.anchors.ambiguous?'Multiple detections · frame one person':
      track?.status==='uncertain'?'Tracking uncertain':track?'Person detected':
        active?'Looking for a person':'Person tracking off');
    this.text('destination',selected?'Captions attached':'Neutral captions');
    this.text('person',selected?'Clear person selection':'Select tracked person');
    this.get<HTMLButtonElement>('person').disabled=track?.status!=='visible';
    this.marker.disabled=track?.status!=='visible';
    this.marker.setAttribute('aria-pressed',String(selected));
    this.marker.setAttribute('aria-label',selected?'Clear person selection':'Select tracked person');
    this.press('person',selected);
    const devices=this.get<HTMLSelectElement>('devices');
    const deviceKey=JSON.stringify(tracking.devices.map(d=>[d.deviceId,d.label]));
    if(devices.dataset.key!==deviceKey){
      devices.dataset.key=deviceKey;
      devices.replaceChildren(new Option('Default',''),...tracking.devices.filter(d=>d.deviceId)
        .map((d,i)=>new Option(d.label||`Camera ${i+1}`,d.deviceId)));
      devices.value=tracking.deviceId;
    }
    this.press('speech-mode',this.mode==='speech');
    this.press('sign-mode',this.mode==='sign');
    this.get('speech-tools').hidden=this.mode!=='speech';
    this.get('speech').hidden=this.mode!=='speech';
    this.get('sign').hidden=this.mode!=='sign';
    this.get('output').hidden=this.mode==='sign';
    this.get('sign-output').hidden=this.mode!=='sign';
    this.get<HTMLSelectElement>('language').value=speech.options.language;
    this.get<HTMLSelectElement>('output').value=speech.options.output;
    this.text('speech',speech.active?'Stop listening':speech.busy&&!speech.recognizer.ready?'Cancel preparation':
      speech.recognizer.ready?'Start listening':'Prepare speech');
    this.get('file-label').hidden=!speech.recognizer.ready||speech.active||speech.busy;
    this.text('sign',sign.active?'Stop signing':'Start signing');
    this.get<HTMLButtonElement>('sign').disabled=tracking.state!=='tracking'&&!sign.active;
    const progress=speech.state.progress;
    const speechStatus=sampleError||speech.state.message+(speech.state.state==='downloading'&&progress!==undefined?` (${Math.round(progress)}%)`:'');
    this.text('model-status',speech.recognizer.ready?`Whisper ${speech.options.model} · Ready`:speechStatus);
    this.text('speech-model',speech.recognizer.ready?'Speech model loaded':speech.busy?'Cancel model loading':'Load speech model');
    this.get<HTMLButtonElement>('speech-model').disabled=speech.recognizer.ready;
    this.get<HTMLButtonElement>('speech').disabled=speech.busy&&!speech.active&&speech.recognizer.ready;
    this.get('input-status').dataset.state=this.mode==='sign'?sign.state:speech.state.state;
    this.text('input-status',this.mode==='speech'?
      (speech.recording?'MIC ON · ':'')+speechStatus+(speech.state.state==='processing'?' · Usually 5–13 seconds.':''):
      (sign.active||sign.pending||sign.state==='unavailable'?sign.message:active?'Start signing when ready.':'Start the camera before signing.'));
    this.get('candidates').hidden=this.mode!=='sign'||!sign.pending;
    this.text('review-title',sign.pending?.uncertain?'Not sure':'Review sign');
    this.get('candidates').dataset.uncertain=String(Boolean(sign.pending?.uncertain));
    this.text('review-source',sign.pending?.input==='reference-replay'?'Reference clip':'Local ASL');
    const choices=this.get('choices');
    const choiceKey=JSON.stringify([sign.pending?.candidates.map(c=>c.label),sign.selected]);
    if(choices.dataset.key!==choiceKey){
      choices.dataset.key=choiceKey;
      const oldFocus=choices.contains(document.activeElement);
      choices.replaceChildren(...(sign.pending?.candidates??[]).map((c,i)=>{
        const button=document.createElement('button');
        button.type='button';button.textContent=c.label;
        button.setAttribute('aria-pressed',String(sign.selected===i));
        button.addEventListener('click',()=>sign.choose(i));
        return button;
      }));
      if(oldFocus)(choices.children[sign.selected] as HTMLElement|undefined)?.focus();
    }
    this.text('size',`Text size ${this.preferences.size===20?'S':this.preferences.size===29?'L':'M'}`);
    this.press('contrast',this.preferences.contrast);
    this.press('motion',this.preferences.reducedMotion);
    const history=this.get('history');
    const diagnostics=this.get<HTMLDetailsElement>('sign-diagnostics');
    diagnostics.hidden=this.mode!=='sign';
    if(!diagnostics.hidden&&diagnostics.open){
      const model=sign.state==='starting'?'Loading GestureSign…':sign.active||sign.pending?'GestureSign · Ready':'GestureSign loads when signing starts.';
      this.text('sign-model-status',model);
      this.text('sign-diagnostic-text',sign.diagnosticLines().join('\n'));
    }
    this.get('empty-history').hidden=this.captions.history.length>0;
    if(this.get<HTMLDetailsElement>('reading-options').open){
      const key=this.captions.history.map(event=>event.id+':'+event.timestamp).join('|');
      if(history.dataset.key!==key){
        history.dataset.key=key;
        history.replaceChildren(...[...this.captions.history].reverse().map(event=>{
          const line=document.createElement('li');
          line.textContent=`${event.displayText} — ${labels[event.sourceLanguage]} → ${labels[event.targetLanguage]} · ${captionSource(event)}`;
          return line;
        }));
      }
    }
  }

  snapshot() {
    return {visible:this.visible,mode:this.mode,track:this.tracking.anchors.current(performance.now()),selected:this.selectedPerson(),
      mirrored:this.mirror,camera:this.tracking.state,active:this.tracking.camera.active,
      frames:this.tracking.frameCount,meanLandmarkMs:this.tracking.meanMs,error:this.tracking.lastError,message:this.tracking.message};
  }

  private get<T extends HTMLElement=HTMLElement>(key:string): T {return this.root.querySelector<T>(`[data-ar="${key}"]`)!;}
  private text(key:string,value:string):void {const node=this.get(key);if(node.textContent!==value)node.textContent=value;}
  private press(key:string,value:boolean):void {this.get(key).setAttribute('aria-pressed',String(value));}
  private click(key:string,action:()=>void):void {this.get(key).addEventListener('click',action);}
}
