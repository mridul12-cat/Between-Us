import type { CaptionEvent, CaptionRecord, CaptionSink } from './contracts.js';

/** Validates revisions, cancels by ID, bounds history and keeps unknown people neutral. */
export class CaptionCoordinator implements CaptionSink {
  readonly active = new Map<string, CaptionRecord>();
  readonly history: CaptionEvent[] = [];
  private readonly latest = new Map<string, { timestamp: number; id: string }>();
  private readonly revisions = new Map<string, CaptionEvent>();
  paused = false;
  constructor(private readonly speakers: ReadonlySet<string>) {}

  receive(event: CaptionEvent): boolean {
    if (!validEvent(event)) return false;
    const previous = this.revisions.get(event.id);
    if (previous && (previous.status === 'cancelled' || previous.timestamp > event.timestamp ||
      (previous.timestamp === event.timestamp && previous.displayText === event.displayText && previous.status === event.status))) return false;
    const anchorId = event.speakerId && this.speakers.has(event.speakerId) ? event.speakerId : 'neutral';
    if (event.status === 'cancelled') {
      this.revisions.set(event.id, { ...event });
      for (const [key, record] of this.active) if (record.event.id === event.id) this.active.delete(key);
      return true;
    }
    const order = this.latest.get(anchorId);
    if (order && (order.timestamp > event.timestamp || (order.timestamp === event.timestamp && order.id !== event.id))) return false;
    const current = this.active.get(anchorId);
    // A pin protects its reading surface; incoming events remain in history.
    if (!current?.pinned || current.event.id === event.id) {
      this.active.set(anchorId, {
        event: { ...event }, anchorId, association: anchorId === 'neutral' ? 'neutral' : 'known',
        age: 0, pinned: current?.event.id === event.id && current.pinned,
        expanded: current?.expanded ?? true, state: 'receiving',
      });
    }
    this.latest.set(anchorId, { timestamp: event.timestamp, id: event.id });
    this.revisions.set(event.id, { ...event });
    const index = this.history.findIndex(item => item.id === event.id);
    if (index >= 0) this.history[index] = { ...event };
    else this.history.push({ ...event });
    if (this.history.length > 24) this.history.shift();
    if (this.revisions.size > 128) this.revisions.delete(this.revisions.keys().next().value!);
    return true;
  }
  tick(delta: number): boolean {
    let changed = false;
    for (const record of this.active.values()) {
      const before = record.state;
      if (!this.paused && !record.pinned) record.age += Math.min(Math.max(delta, 0), 0.1);
      record.state = record.pinned ? 'pinned' : this.paused ? 'paused' :
        record.age > 14 ? 'expired' : record.event.status === 'uncertain' ? 'uncertain' :
        record.event.status === 'waiting' ? 'waiting' : record.age < 0.55 || record.event.status === 'receiving' ? 'receiving' : 'displaying';
      if (before !== record.state) changed = true;
    }
    return changed;
  }
  pin(anchor: string): void { const r = this.active.get(anchor); if (r) { r.pinned = !r.pinned; r.age = 0; } }
  expand(anchor: string): void { const r = this.active.get(anchor); if (r) r.expanded = !r.expanded; }
  retireAnchor(anchor: string): void { this.active.delete(anchor); this.latest.delete(anchor); }
  clear(): void { this.active.clear(); this.history.length = 0; this.latest.clear(); this.revisions.clear(); }
}
export function validEvent(value: unknown): value is CaptionEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as CaptionEvent;
  return typeof e.id === 'string' && e.id.length > 0 && e.id.length < 160 &&
    typeof e.originalText === 'string' && typeof e.displayText === 'string' && e.displayText.length <= 2400 &&
    Number.isFinite(e.timestamp) && (e.confidence === undefined || (Number.isFinite(e.confidence) && e.confidence >= 0 && e.confidence <= 1)) &&
    ['speech', 'sign'].includes(e.modality) && ['en', 'hi', 'es', 'und', 'ase'].includes(e.sourceLanguage) &&
    ['en', 'hi', 'es', 'und'].includes(e.targetLanguage) && ['waiting', 'receiving', 'final', 'uncertain', 'cancelled'].includes(e.status) &&
    ['predefined-demo', 'model-output'].includes(e.provenance) && (e.speakerId === undefined || typeof e.speakerId === 'string');
}
