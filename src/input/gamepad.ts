// Controller adapter between the browser's Gamepad API and the engine.
//
// The engine's SDL layer reads controllers through navigator.getGamepads() and the gamepadconnected /
// gamepaddisconnected events, and applies one fixed "standard" layout to every device (SDL 3.4 has no other
// mapping for browsers): a controller the browser reports without the standard mapping (mapping "", common for
// Bluetooth controllers the browser does not recognise) gets the wrong sticks and buttons, or none.
//
// This adapter sits in front of it: it shows the engine one virtual controller in the standard layout (index 0),
// built from the physical controller chosen by the player (or, automatically, the one in use, else the first connected), with that
// device's mapping: the browser's own for standard controllers, else a guess that the player can correct with
// the calibration in Browser settings. Stick centres measured during calibration are subtracted (drifting sticks).
// The engine applies dead zones, look speed and inversion itself (its joy_* settings, set by the page).

/** One input of the physical controller: a button, or one direction of an axis (dir = sign). */
export type Source = { b: number } | { a: number; dir: 1 | -1 } | null;

/** Standard layout (W3C Gamepad "standard" mapping): 17 buttons, 4 axes. */
export const STD_BUTTONS = [
  'A / Cross', 'B / Circle', 'X / Square', 'Y / Triangle', 'Left shoulder', 'Right shoulder', 'Left trigger',
  'Right trigger', 'Back / Select', 'Start / Menu', 'Left stick press', 'Right stick press', 'D-pad up',
  'D-pad down', 'D-pad left', 'D-pad right', 'Home / Guide',
] as const;
export const STD_AXES = ['Left stick X', 'Left stick Y', 'Right stick X', 'Right stick Y'] as const;

export interface PadProfile {
  /** physical source of each standard button (index = standard button) */
  buttons: Source[];
  /** physical axis for each standard axis, with inversion */
  axes: Array<{ a: number; invert: boolean } | null>;
  /** resting value of each physical axis, subtracted (stick drift) */
  centers: number[];
}

export interface RawPad {
  id: string;
  index: number;
  mapping: string;
  connected: boolean;
  timestamp: number;
  axes: readonly number[];
  buttons: ReadonlyArray<{ pressed: boolean; value: number; touched?: boolean }>;
}

/** The layout a controller probably has: the browser's own when it reports the standard mapping. */
export function defaultProfile(pad: Pick<RawPad, 'mapping' | 'axes' | 'buttons'>): PadProfile {
  const n = pad.buttons.length;
  const buttons: Source[] = STD_BUTTONS.map((_, i) => (i < n ? { b: i } : null));
  const axes: PadProfile['axes'] = STD_AXES.map((_, i) => (i < pad.axes.length ? { a: i, invert: false } : null));
  if (pad.mapping !== 'standard') {
    // common non-standard layouts: right stick on axes 2/3 (4 axes) or 3/4 (6+ axes, 2 = a trigger)
    if (pad.axes.length >= 6) {
      axes[2] = { a: 3, invert: false };
      axes[3] = { a: 4, invert: false };
    }
    // d-pad as a hat on the last two axes (many HID controllers)
    if (n < 16 && pad.axes.length >= 6) {
      const hx = pad.axes.length - 2;
      const hy = pad.axes.length - 1;
      buttons[12] = { a: hy, dir: -1 };
      buttons[13] = { a: hy, dir: 1 };
      buttons[14] = { a: hx, dir: -1 };
      buttons[15] = { a: hx, dir: 1 };
    }
  }
  return { buttons, axes, centers: pad.axes.map(() => 0) };
}

/** Normalised state of a physical controller under a profile. */
export function normalize(pad: RawPad, p: PadProfile): { axes: number[]; buttons: number[] } {
  const axis = (i: number) => {
    const v = pad.axes[i] ?? 0;
    const c = p.centers[i] ?? 0;
    // rescale so that the full travel on either side of the centre still reaches 1
    return v >= c ? (c >= 1 ? 0 : (v - c) / (1 - c)) : (c <= -1 ? 0 : (v - c) / (1 + c));
  };
  const value = (s: Source) => {
    if (!s) return 0;
    if ('b' in s) return pad.buttons[s.b]?.value ?? (pad.buttons[s.b]?.pressed ? 1 : 0);
    return Math.max(0, axis(s.a) * s.dir);
  };
  return {
    axes: p.axes.map((m) => (m ? Math.max(-1, Math.min(1, axis(m.a) * (m.invert ? -1 : 1))) : 0)),
    buttons: p.buttons.map((s) => Math.max(0, Math.min(1, value(s)))),
  };
}

/** A press or a deliberate stick push, not drift: used to pick the active controller and the input mode. */
export function activity(pad: RawPad, p?: PadProfile): boolean {
  if (pad.buttons.some((b) => b.pressed)) return true;
  const n = p ? normalize(pad, p).axes : pad.axes;
  return n.some((v) => Math.abs(v) > 0.5);
}

/** Virtual standard controller handed to the engine (the shape Emscripten's gamepad code reads). */
export function virtualPad(pad: RawPad, p: PadProfile, timestamp: number) {
  const n = normalize(pad, p);
  return {
    id: pad.id, // the engine reads vendor/product ids from it
    index: 0,
    mapping: 'standard',
    connected: true,
    timestamp,
    axes: n.axes,
    buttons: n.buttons.map((v, i) => ({ value: v, pressed: v > (i === 6 || i === 7 ? 0.12 : 0.5), touched: v > 0 })),
    vibrationActuator: (pad as { vibrationActuator?: unknown }).vibrationActuator ?? null,
  };
}

/** What the game does with the virtual controller's state under the browser's default bindings (Help). */
export function padActions(axes: number[], buttons: number[], dead: number): string[] {
  const out: string[] = [];
  const [lx = 0, ly = 0, rx = 0, ry = 0] = axes;
  const dir = (x: number, y: number, v: [string, string, string, string]) =>
    [y < -dead ? v[0] : y > dead ? v[1] : '', x < -dead ? v[2] : x > dead ? v[3] : ''].filter(Boolean).join(' + ');
  if (Math.hypot(lx, ly) > dead) out.push(`move ${dir(lx, ly, ['forward', 'back', 'left', 'right'])}`);
  if (Math.hypot(rx, ry) > dead) out.push(`look ${dir(rx, ry, ['up', 'down', 'left', 'right'])}`);
  const names = ['jump', 'crouch', 'use', 'reload', 'previous weapon', 'next weapon', 'alternate fire', 'fire', 'objectives',
    'game menu', 'run', 'use item', 'next item', 'previous item', 'lean left', 'lean right'];
  buttons.forEach((v, i) => { if (v > (i === 6 || i === 7 ? 0.2 : 0.5) && names[i]) out.push(names[i]); });
  return out;
}

export type PadChoice = 'auto' | string; // a controller id

const PROFILES_KEY = 'sof.pads';

export function loadProfiles(): Record<string, PadProfile> {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function saveProfile(id: string, p: PadProfile | null) {
  const all = loadProfiles();
  if (p) all[id] = p; else delete all[id];
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

export interface AdapterStatus {
  supported: boolean;
  secure: boolean;
  /** physical controllers the browser exposes */
  pads: RawPad[];
  /** the one handed to the engine (index into navigator's list), or null */
  active: RawPad | null;
  profile: PadProfile | null;
  virtual: ReturnType<typeof virtualPad> | null;
  events: string[];
}

/**
 * Installs the adapter: replaces navigator.getGamepads for everything loaded after it (the engine, the
 * startup page's controller navigation) and turns the browser's connection events into events of the
 * virtual controller. Must run before the engine script loads.
 */
export class GamepadAdapter {
  private raw: (() => ReadonlyArray<RawPad | null>) | null;
  private activeId: string | null = null;
  private activeIndex = -1;
  private shown: ReturnType<typeof virtualPad> | null = null;
  private profiles = loadProfiles();
  private stamp = 0;
  private lastKey = '';
  private pendingGone = false;
  readonly events: string[] = [];
  /** called when the chosen controller is used (button or deliberate stick push) */
  onActivity: (() => void) | null = null;
  /** called when the controller handed to the engine changes (null: none any more) */
  onConnection: ((pad: RawPad | null) => void) | null = null;
  /** called when a button of the controller handed to the engine goes down (standard-mapping index) */
  onPress: ((button: number) => void) | null = null;
  private pressed = 0;

  constructor(private win: Window & typeof globalThis = window, public choice: PadChoice = 'auto') {
    const nav = win.navigator as Navigator & { getGamepads?: () => ReadonlyArray<RawPad | null> };
    this.raw = typeof nav.getGamepads === 'function' ? nav.getGamepads.bind(nav) : null;
    if (!this.raw) {
      this.log('page loaded: this browser has no Gamepad API here (insecure page or unsupported browser)');
      return;
    }
    this.log(`page loaded: ${this.physical().length} controller(s) reported before any press`);
    Object.defineProperty(nav, 'getGamepads', { configurable: true, value: () => this.list() });
    for (const type of ['gamepadconnected', 'gamepaddisconnected'] as const) {
      // registered before the engine's listeners: the browser's own events stop here (they describe the
      // physical controller); the engine sees the virtual controller's events instead
      win.addEventListener(type, (e) => {
        if (!(e as Event & { __virtual?: boolean }).__virtual) {
          e.stopImmediatePropagation();
          const g = (e as GamepadEvent).gamepad;
          this.log(`${type === 'gamepadconnected' ? 'connected' : 'disconnected'}: #${g?.index} "${g?.id}" (mapping "${g?.mapping}", ${g?.buttons.length} buttons, ${g?.axes.length} axes)`);
          this.update();
        }
      });
    }
    // controllers connected before the page loaded show up after their first press, and Android may not send
    // events at all: poll as well
    const tick = () => { this.update(); this.win.requestAnimationFrame(tick); };
    this.win.requestAnimationFrame(tick);
  }

  get supported() { return !!this.raw; }

  /** Physical controllers as the browser reports them. */
  physical(): RawPad[] {
    try {
      return [...(this.raw?.() ?? [])].filter((p): p is RawPad => !!p && p.connected !== false);
    } catch {
      return [];
    }
  }

  profileFor(pad: RawPad): PadProfile {
    const saved = this.profiles[pad.id];
    if (saved && saved.buttons?.length === STD_BUTTONS.length && saved.axes?.length === STD_AXES.length) return saved;
    return defaultProfile(pad);
  }

  setProfile(id: string, p: PadProfile | null) {
    saveProfile(id, p);
    this.profiles = loadProfiles();
  }

  setChoice(choice: PadChoice) {
    this.choice = choice;
    this.update();
  }

  status(): AdapterStatus {
    const pads = this.physical();
    const active = pads.find((p) => p.index === this.activeIndex && p.id === this.activeId) ?? null;
    return {
      supported: this.supported, secure: this.win.isSecureContext, pads, active,
      profile: active ? this.profileFor(active) : null, virtual: this.shown, events: this.events,
    };
  }

  private list() {
    // called by the engine during its frame: no callbacks (they call back into the engine)
    this.update(false);
    return [this.shown];
  }

  /** Picks the controller handed to the engine and announces changes as connect / disconnect events. */
  update(notify = true) {
    const pads = this.physical();
    let active = pads.find((p) => p.index === this.activeIndex && p.id === this.activeId) ?? null;
    if (this.choice !== 'auto' && active?.id !== this.choice) active = pads.find((p) => p.id === this.choice) ?? null;
    if (this.choice === 'auto') {
      // keep the current one while it is connected; otherwise the one being used, else the first one: handed over
      // at once, because the engine opens a newly connected controller only after about 100 frames
      if (!active) active = pads.find((p) => activity(p, this.profileFor(p))) ?? pads[0] ?? null;
    }
    if (notify && active && activity(active, this.profileFor(active))) this.onActivity?.();
    const before = this.activeId !== null ? `${this.activeIndex}|${this.activeId}` : '';
    const now = active ? `${active.index}|${active.id}` : '';
    if (before && before !== now) {
      const gone = this.shown;
      this.shown = null;
      this.activeId = null;
      this.activeIndex = -1;
      this.dispatch('gamepaddisconnected', gone);
      this.log('no controller handed to the game any more');
      if (!active) this.pendingGone = true;
    }
    if (notify && this.pendingGone && !active) {
      this.pendingGone = false;
      this.onConnection?.(null);
    }
    if (active) {
      const v = virtualPad(active, this.profileFor(active), 0);
      // a new timestamp whenever the virtual state changes (the engine skips unchanged samples)
      const key = v.axes.join() + v.buttons.map((b) => b.value).join();
      if (key !== this.lastKey) { this.lastKey = key; this.stamp = Math.max(this.stamp + 1, Math.floor(performance.now())); }
      v.timestamp = this.stamp;
      const pressed = v.buttons.reduce((m, b, i) => m | (b.pressed ? 1 << i : 0), 0);
      if (notify) for (let i = 0; i < v.buttons.length; i++) if (pressed & ~this.pressed & (1 << i)) this.onPress?.(i);
      this.pressed = pressed;
      this.shown = v;
      if (before !== now) {
        this.activeId = active.id;
        this.activeIndex = active.index;
        this.log(`handed to the game: #${active.index} "${active.id}"`);
        this.dispatch('gamepadconnected', v);
        this.pendingGone = false;
        if (notify) this.onConnection?.(active);
      }
    }
  }

  private dispatch(type: string, pad: unknown) {
    const e = new Event(type) as Event & { gamepad?: unknown; __virtual?: boolean };
    Object.defineProperty(e, 'gamepad', { value: pad });
    e.__virtual = true;
    this.win.dispatchEvent(e);
  }

  private log(line: string) {
    this.events.push(`${new Date().toLocaleTimeString()} ${line}`);
    if (this.events.length > 30) this.events.shift();
  }
}
