// Input diagnostics: where controller input stops on the way browser → adapter → engine → gameplay.
//
// During play the page samples, four times a second, what the browser reports (raw), what the adapter hands the
// engine (the standard layout) and what the engine holds (Browser_PadState: stick values and the keys it has down
// for the controller's buttons), together with what the game is doing (play, menu, console, paused). The counters say
// at which stage input disappears, e.g. "buttons pressed during play: 40 samples, engine keys held: 0". The last
// session's trace is kept in this browser (localStorage) so the report on the startup page includes it after
// returning from the game. Nothing leaves the device unless the player copies the report.

/** Removes access keys from any text (URLs with ?key=, cookies). */
export function redact(text: string): string {
  return text
    .replace(/([?&#]key=)[^&#\s"']+/gi, '$1[redacted]')
    .replace(/(sof_key=)[^;\s"']+/gi, '$1[redacted]');
}

export interface TraceSample {
  /** the game takes input for play (not menu, console or pause) */
  inGame: boolean;
  /** the game's state name: play, menu, console, message, paused, loading */
  state: string;
  /** a controller reported by the browser, and one handed to the engine */
  raw: boolean;
  handed: boolean;
  /** standard-layout stick values and pressed buttons (bits) the adapter hands over */
  axes: number[];
  buttons: number;
  /** what the engine holds: controller open, stick values (-1..1), keys down for the buttons (bits) */
  engineOpen: boolean;
  engineAxes: number[];
  engineKeys: number;
}

const STICK = 0.3;

/** Counters per stage; a stage that sees input while the one before it did not is where it stops. */
export class InputTrace {
  started = new Date().toISOString();
  samples = 0;
  inGame = 0;
  rawPresent = 0;
  handed = 0;
  engineOpen = 0;
  /** samples during play with a pushed stick / a pressed button at the adapter, and those the engine also held */
  stickIn = 0;
  stickEngine = 0;
  buttonIn = 0;
  buttonEngine = 0;
  /** input while a menu, the pause or a cinematic was up (it then goes to the menu or nowhere, not to play) */
  inputOutsidePlay = 0;
  states: Record<string, number> = {};
  last = '';

  add(s: TraceSample) {
    this.samples++;
    this.states[s.state] = (this.states[s.state] ?? 0) + 1;
    if (s.raw) this.rawPresent++;
    if (s.handed) this.handed++;
    if (s.engineOpen) this.engineOpen++;
    const stick = s.axes.some((v) => Math.abs(v) > STICK);
    const input = stick || s.buttons !== 0;
    if (!s.inGame) {
      if (input) this.inputOutsidePlay++;
      return;
    }
    this.inGame++;
    if (stick) {
      this.stickIn++;
      if (s.engineAxes.some((v) => Math.abs(v) > STICK)) this.stickEngine++;
    }
    if (s.buttons) {
      this.buttonIn++;
      if (s.engineKeys & s.buttons) this.buttonEngine++;
    }
  }

  /** The first stage at which input observed during play did not arrive, in plain words. */
  verdict(): string {
    if (!this.samples) return 'no game session recorded yet';
    if (!this.rawPresent) return 'the browser never reported a controller during the game (pairing, secure context, or the browser does not expose this controller)';
    if (!this.handed) return 'the browser reported a controller, but the page never handed it to the game';
    if (!this.engineOpen) return 'the game never opened the controller';
    if (!this.stickIn && !this.buttonIn) {
      return this.inputOutsidePlay ? 'controller input arrived only while a menu, the pause or a cinematic was up, not during play' : 'no controller input during play was seen';
    }
    const parts: string[] = [];
    if (this.stickIn) parts.push(`sticks during play: ${this.stickEngine}/${this.stickIn} samples reached the game`);
    if (this.buttonIn) parts.push(`buttons during play: ${this.buttonEngine}/${this.buttonIn} samples reached the game`);
    return parts.join('; ');
  }

  text(): string {
    return [
      `Session started ${this.started}; ${this.samples} samples (4 per second), ${this.inGame} during play`,
      `States: ${Object.entries(this.states).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`,
      `Controller reported by the browser: ${this.rawPresent}; handed to the game: ${this.handed}; open in the game: ${this.engineOpen}`,
      `Input during play: sticks ${this.stickIn} (game held ${this.stickEngine}), buttons ${this.buttonIn} (game held ${this.buttonEngine}); input in menus/pause: ${this.inputOutsidePlay}`,
      `Verdict: ${this.verdict()}`,
      ...(this.last ? ['Last sample:', this.last] : []),
    ].join('\n');
  }
}

const KEY = 'sof.inputtrace';

export function saveTrace(t: InputTrace) {
  try { localStorage.setItem(KEY, t.text()); } catch { /* private mode */ }
}

export function lastTrace(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
