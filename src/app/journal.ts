// Session journal: a small, bounded record of what the game was doing, kept in localStorage while it runs so that it
// survives a session that ends badly (the browser ending the page under memory pressure, a hang the player escapes by
// closing the app). The next start of the page shows the previous session's last moments if it did not end
// normally - or ended normally (the tab closed, Quit) after the game had looked stuck: a cinematic that does not end,
// a level load that does not finish, a pause during a cinematic, frames not drawn. The previous session's record is
// kept as well, and both can be opened from Browser settings at any time. Recorded: page start/end, level and map changes, cinematic and menu state changes, skip presses, frame
// stalls, data-read slowness, WebGL context loss, errors. Never recorded: access keys (redacted), file contents,
// file paths outside the game's virtual paths.

import { redact as redactKeys } from './diagnostics';

const KEY = 'sof.journal';
const PREV_KEY = 'sof.journal.prev';
const MAX_EVENTS = 160;
const MAX_TEXT = 160;

export interface JournalEvent { t: number; m: string }

export interface JournalRecord {
  version: 1;
  startedAt: string;
  /** set when the session ended through Quit, a reload or closing the page normally */
  ended: string | null;
  /** last heartbeat: wall-clock time, and how long before it the last frame was drawn */
  beatAt: string;
  sinceFrameMs: number;
  stage: string;
  events: JournalEvent[];
  /** page, engine and offline-cache versions and the game data in use (added later: absent in older records) */
  build?: string;
  /** the first sign that the game looked stuck, even if the page was then closed normally */
  trouble?: string | null;
}

function read(key: string): JournalRecord | null {
  try {
    const r = JSON.parse(localStorage.getItem(key) ?? 'null') as JournalRecord | null;
    return r && r.version === 1 && Array.isArray(r.events) ? r : null;
  } catch {
    return null;
  }
}

/** Removes access keys (the input report's rules) and anything else that looks like a token from text that may be shared. */
export function redact(s: string): string {
  return redactKeys(s).replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}\b/g, '[redacted]');
}

export class Journal {
  private rec: JournalRecord;
  private t0 = performance.now();
  private dirty = false;
  lastFrame = performance.now();

  constructor(build = '') {
    const now = new Date().toISOString();
    this.rec = { version: 1, startedAt: now, ended: null, beatAt: now, sinceFrameMs: 0, stage: 'start page', events: [], build, trouble: null };
    // the session before this one stays readable (a failing session followed by one more start)
    try {
      const old = localStorage.getItem(KEY);
      if (old) localStorage.setItem(PREV_KEY, old);
    } catch { /* private mode */ }
  }

  /** The previous session's record when it did not end normally or looked stuck before it ended (shown once). */
  static previousUnclean(): JournalRecord | null {
    const r = read(KEY);
    return r && (!r.ended || r.trouble) && r.stage !== 'start page' ? r : null;
  }

  /** The last two sessions' records, newest first, however they ended (Browser settings). */
  static recent(): JournalRecord[] {
    return [read(KEY), read(PREV_KEY)].filter((r): r is JournalRecord => !!r);
  }

  static forget() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(PREV_KEY); } catch { /* private mode */ }
  }

  get troubled(): boolean { return !!this.rec.trouble; }

  /** Marks the session as having looked stuck (the first reason is kept) and stores the record at once. */
  trouble(reason: string) {
    this.add(`looks stuck: ${reason}`);
    if (!this.rec.trouble) this.rec.trouble = redact(reason).slice(0, MAX_TEXT);
    this.flush(true);
  }

  add(m: string) {
    this.rec.events.push({ t: Math.round(performance.now() - this.t0), m: redact(m).slice(0, MAX_TEXT) });
    if (this.rec.events.length > MAX_EVENTS) this.rec.events.splice(0, this.rec.events.length - MAX_EVENTS);
    this.dirty = true;
  }

  setStage(stage: string) {
    if (stage === this.rec.stage) return;
    this.rec.stage = stage;
    this.add(`stage: ${stage}`);
  }

  /** Writes the record (throttled by the caller's heartbeat; forced at the end and on page hide). */
  flush(force = false) {
    if (!this.dirty && !force) return;
    this.rec.beatAt = new Date().toISOString();
    this.rec.sinceFrameMs = Math.round(performance.now() - this.lastFrame);
    try { localStorage.setItem(KEY, JSON.stringify(this.rec)); } catch { /* storage full or private mode */ }
    this.dirty = false;
  }

  end(reason: string) {
    this.add(`end: ${reason}`);
    this.rec.ended = new Date().toISOString();
    this.flush(true);
  }

  /** The page is still alive: heartbeat with the time since the last frame. */
  beat() {
    this.dirty = true;
    this.flush();
  }
}

/** Plain-text report of a record (for the start page's "copy" button). */
export function journalText(r: JournalRecord): string {
  const lines = [
    `Soldier of Fortune Web session report (access keys removed)`,
    `Build: ${r.build || 'not recorded (older version)'}`,
    `Started ${r.startedAt}; last sign of life ${r.beatAt}; ${r.ended ? `page closed normally ${r.ended}` : 'did NOT end normally'}`,
    ...(r.trouble ? [`Looked stuck: ${r.trouble}`] : []),
    `Stage at the end: ${r.stage}; last frame drawn ${(r.sinceFrameMs / 1000).toFixed(1)} s before the last sign of life`,
    ...r.events.map((e) => `${(e.t / 1000).toFixed(1).padStart(7)} s  ${e.m}`),
  ];
  return lines.join('\n');
}

/** A one-line reading of how the previous session ended. */
export function interpret(r: JournalRecord): string {
  const last = r.events[r.events.length - 1]?.m ?? '';
  if (r.trouble && r.ended) return `the game looked stuck (${r.trouble}) and the page was then closed`;
  if (r.sinceFrameMs > 5000) {
    return `the game had stopped drawing ${Math.round(r.sinceFrameMs / 1000)} s before the page stopped (${r.stage}): a stall in the game or its data reads`;
  }
  if (/context lost/.test(last)) return 'the browser took the graphics context away (often memory pressure)';
  return `the page stopped while the game was running normally (${r.stage}): most likely the browser ended it ` +
    '(memory pressure) or the app was closed';
}

/** The engine function names in an error's stack, innermost first (the engine is built with its function names). */
export function engineFrames(err: unknown): string {
  const stack = String((err as Error)?.stack ?? '');
  const names = [...stack.matchAll(/at (?:[\w$.]+\.)?([\w$]+) \((?:wasm:|[^)]*wasm-function)/g)].map((m) => m[1]);
  return names.slice(0, 16).join(' < ');
}
