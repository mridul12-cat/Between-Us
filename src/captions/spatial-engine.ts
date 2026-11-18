import { Quaternion, UIKitMLAsset, Vector3, type World } from '@iwsdk/core';
import type { CaptionCoordinator } from './coordinator.js';
import type { CaptionEvent, CaptionRecord } from './contracts.js';
import { TextSurface } from './text-surface.js';
import { speakers } from '../demo/samples.js';

export interface ReadingPreferences { size: number; contrast: boolean; reducedMotion: boolean }
interface Bubble {
  id: string;
  panel: UIKitMLAsset;
  surface: TextSurface;
  key: string;
  revision: string;
  target: Quaternion;
  homeScale: number;
  height: number;
  entrance: number;
  opacity: number;
  x: number;
  y: number;
  distance: number;
  top: number;
}

const languageName = {en:'English', hi:'Hindi', es:'Spanish', ase:'ASL', und:'Auto'};
export function captionSource(event: CaptionEvent): string {
  const inference = event.inference;
  if (event.provenance === 'predefined-demo') return 'Predefined example';
  if (inference?.runtime === 'local-whisper') {
    const task = inference.task === 'translate' ? 'Local translation' : 'Local transcription';
    return inference.input === 'recorded-sample' ? task + ' / recorded sample' : task;
  }
  if (inference?.runtime === 'local-gesturesign') {
    return inference.input === 'reference-replay' ? 'Local ASL / reference clip' : 'Local ASL / camera';
  }
  return 'Model output';
}

function captionStatus(record: CaptionRecord): string {
  const states: string[] = [];
  if (record.pinned) states.push('Pinned');
  if (record.event.status === 'uncertain') states.push('Not sure');
  if (record.event.inference?.runtime === 'local-gesturesign' && record.event.inference.confirmed) states.push('Confirmed');
  if (record.state === 'paused') states.push('Paused');
  if (record.state === 'waiting') states.push('Waiting');
  if (record.event.provenance === 'predefined-demo' && !states.length) return 'Demo';
  return states.join(' / ');
}

/** Four reusable UIKit surfaces attached to the speaker transforms. */
export class SpatialCaptionEngine {
  private readonly bubbles: Bubble[] = [];
  private readonly viewer = new Vector3();
  private readonly position = new Vector3();
  private processing?: string;

  constructor(private readonly world: World, private readonly coordinator: CaptionCoordinator,
    private readonly preferences: ReadingPreferences, cleanup: Array<() => void>,
    private readonly onSelect: (id: string) => void) {
    for (const id of ['asha', 'lucia', 'alex', 'neutral']) {
      const panel = world.requireSceneObject<UIKitMLAsset>('anchor-' + id);
      const surface = new TextSurface(364);
      panel.requireElementById('text-area').add(surface.image);
      this.bubbles.push({id, panel, surface, key:'', revision:'', target:new Quaternion(),
        homeScale:panel.scale.x, height:0, entrance:1, opacity:1, x:0, y:0, distance:1, top:0});
      for (const action of ['pin','expand']) {
        const element = panel.requireElementById(action);
        element.name = `${id}-${action}`;
        const run = () => {
          if (action === 'pin') coordinator.pin(id);
          else coordinator.expand(id);
          onSelect(id);
          this.refresh();
        };
        element.addEventListener('click', run);
        cleanup.push(() => element.removeEventListener('click', run));
      }
      const area = panel.requireElementById('text-area');
      const select = () => onSelect(id);
      area.addEventListener('click', select);
      cleanup.push(() => area.removeEventListener('click', select), () => surface.dispose());
      panel.visible = false;
    }
  }

  setProcessing(id: string | undefined): void {
    if (this.processing === id) return;
    this.processing = id;
    for (const speaker of speakers) {
      this.world.requireSceneObject<UIKitMLAsset>('identity-' + speaker.id).requireElementById('processing')
        .setProperties({display:id === speaker.id ? 'flex' : 'none'});
    }
  }

  refresh(): void {
    for (const bubble of this.bubbles) {
      const {id, panel, surface} = bubble;
      const record = this.coordinator.active.get(id);
      if (!record) {
        panel.visible = false;
        bubble.key = bubble.revision = '';
        continue;
      }
      if (record.state === 'expired') {
        if (this.preferences.reducedMotion) panel.visible = false;
        continue;
      }
      const revision = record.event.id + ':' + record.event.timestamp + ':' + record.event.displayText;
      if (bubble.revision !== revision || !panel.visible) {
        bubble.revision = revision;
        bubble.entrance = this.preferences.reducedMotion ? 1 : 0;
      }
      panel.visible = true;
      const preferences = this.preferences;
      const key = JSON.stringify([revision, record.state, record.expanded, record.pinned, preferences]);
      if (key === bubble.key) continue;
      bubble.key = key;
      const name = speakers.find(speaker => speaker.id === id)?.name ?? 'Unassigned';
      const color = preferences.contrast ? '#ffffff' : '#24374f';
      const status = captionStatus(record);
      const text = record.state === 'waiting' ? 'Waiting for a caption' :
        record.expanded ? record.event.displayText : 'Caption collapsed';
      const height = Math.min(180, surface.draw(text, preferences.size + 2, color));
      const language = languageName[record.event.sourceLanguage];
      const target = languageName[record.event.targetLanguage];
      const direction = language === target ? target : `${language} to ${target}`;
      panel.requireElementById('speaker').setProperties({text:name, color});
      panel.requireElementById('status').setProperties({text:status, color:preferences.contrast ? color :
        record.event.status === 'uncertain' ? '#82500f' : '#42526a'});
      panel.requireElementById('source').setProperties({text:`${direction} | ${captionSource(record.event)}`, color});
      panel.requireElementById('text-area').setProperties({height});
      panel.requireElementById('pin-label').setProperties({text:record.pinned ? 'Unpin' : 'Pin'});
      panel.requireElementById('expand-label').setProperties({text:record.expanded ? 'Collapse' : 'Expand'});
      panel.requireElementById('pin').setProperties({backgroundColor:record.pinned ? '#efcc86' : '#e3ece9'});
      panel.requireElementById('surface').setProperties({
        backgroundColor:preferences.contrast ? '#131e32' : record.pinned ? '#ffefd5' : '#fffaf2',
        borderColor:record.pinned ? '#a77132' : record.event.status === 'uncertain' ? '#bb8743' : '#80a39f',
      });
      // Toolkit measures centimeters. The source line can wrap on recorded examples.
      bubble.height = (height + (captionSource(record.event).length > 28 ? 152 : 134)) * bubble.homeScale / 100;
    }
  }

  update(delta: number): void {
    this.world.camera.getWorldPosition(this.viewer);
    const reduced = this.preferences.reducedMotion;
    const follow = reduced ? 1 : 1 - Math.exp(-delta * 9);
    for (let index = 0; index < this.bubbles.length; index++) {
      const bubble = this.bubbles[index];
      const {id, panel} = bubble;
      if (!panel.visible) continue;
      const record = this.coordinator.active.get(id);
      if (!record) continue;
      const expired = record.state === 'expired';
      bubble.entrance = reduced ? 1 : Math.min(1, bubble.entrance + delta * 4.5);
      const opacity = expired ? Math.max(0, bubble.opacity - delta * 5) : bubble.entrance * (this.preferences.contrast ? 1 : 0.97);
      if (opacity !== bubble.opacity) {
        bubble.opacity = opacity;
        panel.requireElementById('surface').setProperties({opacity});
      }
      if (!opacity && expired) {
        panel.visible = false;
        continue;
      }
      panel.scale.setScalar(bubble.homeScale * (this.coordinator.paused ? 1 : 0.96 + bubble.entrance * 0.04));
      panel.getWorldPosition(this.position);
      const dx = this.position.x - this.viewer.x;
      const dz = this.position.z - this.viewer.z;
      const distance = Math.max(0.5, Math.hypot(dx, dz));
      const verticalOffset = this.position.y - panel.position.y - this.viewer.y;
      const half = bubble.height * 0.5;
      const base = id === 'neutral' ? 1.93 : 1.81;
      let center = base + half;
      bubble.x = Math.atan2(dx, -dz);
      bubble.distance = distance;
      // Fixed order prevents two neighboring bubbles from repeatedly trading slots.
      for (let earlier = 0; earlier < index; earlier++) {
        const neighbor = this.bubbles[earlier];
        if (!neighbor.panel.visible) continue;
        const horizontalGap = Math.abs(neighbor.x - bubble.x);
        const width = (2 * bubble.homeScale / distance) + (2 * neighbor.homeScale / neighbor.distance);
        if (horizontalGap >= width + 0.026) continue;
        const bottom = (center - half + verticalOffset) / distance;
        const top = (center + half + verticalOffset) / distance;
        if (bottom < neighbor.top + 0.024 && top > neighbor.y - 0.024) {
          center = (neighbor.top + 0.024) * distance - verticalOffset + half;
        }
      }
      bubble.y = (center - half + verticalOffset) / distance;
      bubble.top = (center + half + verticalOffset) / distance;
      panel.position.y += (center - panel.position.y) * follow;
      bubble.target.setFromAxisAngle(this.world.scene.up, Math.atan2(-dx, -dz));
      panel.quaternion.slerp(bubble.target, follow);
    }
  }
}
