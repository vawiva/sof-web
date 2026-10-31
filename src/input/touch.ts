// Touch controls for the running game.
//  - left thumb: analog movement stick (appears where the thumb lands; pushed fully it also holds Run)
//  - free right side: camera look. Finger travel since the previous event, in CSS pixels, times the player's
//    degrees-per-pixel, is handed to the engine once (Browser_Look) and applied at its next input frame, so a
//    swipe turns the camera by the same angle at any resolution, picture shape or frame rate. Lifting the finger
//    stops turning at once; the next touch starts from where it lands (no jump, no spring-back stick).
//  - buttons: held keys for the game's commands; Fire can also be dragged to look (optional)
//  - while one of the game's own menus is open, the stick and buttons step aside (only Menu stays, as the
//    menus' back key) and a finger is the menu pointer: touching moves the menu cursor there, lifting clicks
// Every pointer has exactly one owner (stick, look, a button or the menu pointer), decided when it lands, so
// one finger never steals or doubles another's input. Releasing, cancelling, losing capture, losing focus,
// rotating or hiding the page releases what it held.

import { TOUCH_LOOK_DEFAULTS } from './aim';

export interface TouchButton {
  id: string;
  label: string;
  code: string;      // KeyboardEvent.code sent to the engine
  key: string;       // KeyboardEvent.key
  keyCode: number;   // legacy keyCode, still read by some SDL paths
  side: 'left' | 'right';
  hold?: boolean;    // held while touched (otherwise a tap)
}

export interface TouchSettings {
  opacity: number;     // 0.15 - 1
  scale: number;       // 0.75 - 1.5, button and stick size
  leftHanded: boolean; // stick on the right, look and Fire on the left
  lookX: number;       // degrees of turn per CSS pixel of finger travel
  lookY: number;
  invertY: boolean;
  aimScale: number;    // extra factor while zoomed (scopes), on top of the game's own zoom scaling
  fireLook: boolean;   // dragging the Fire button also turns the camera
  leftFire: boolean;   // a second Fire button on the movement side
  edgeX: number;       // extra distance of the button groups from the screen's side edges, px
  edgeY: number;       // extra distance of the button groups from the bottom / top, px
}

export const DEFAULT_TOUCH: TouchSettings = {
  opacity: 0.55, scale: 1, leftHanded: false, ...TOUCH_LOOK_DEFAULTS, invertY: false, aimScale: 1,
  fireLook: true, leftFire: false, edgeX: 0, edgeY: 0,
};

const num = (v: unknown, lo: number, hi: number, d: number) =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Stored settings, checked and completed (earlier versions stored lookSensitivity / invertLook). */
export function parseTouch(raw: Record<string, unknown> | null | undefined): TouchSettings {
  const r = raw ?? {};
  const d = DEFAULT_TOUCH;
  return {
    opacity: num(r.opacity, 0.15, 1, d.opacity),
    scale: num(r.scale, 0.75, 1.5, d.scale),
    leftHanded: typeof r.leftHanded === 'boolean' ? r.leftHanded : d.leftHanded,
    lookX: num(r.lookX, 0.03, 1.5, d.lookX),
    lookY: num(r.lookY, 0.03, 1.5, d.lookY),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : typeof r.invertLook === 'boolean' ? r.invertLook : d.invertY,
    aimScale: num(r.aimScale, 0.2, 2, d.aimScale),
    fireLook: typeof r.fireLook === 'boolean' ? r.fireLook : d.fireLook,
    leftFire: typeof r.leftFire === 'boolean' ? r.leftFire : d.leftFire,
    edgeX: num(r.edgeX, 0, 160, d.edgeX),
    edgeY: num(r.edgeY, 0, 160, d.edgeY),
  };
}

/** Turn in degrees for a finger travel in CSS pixels (right and down positive). */
export function lookDegrees(dx: number, dy: number, s: Pick<TouchSettings, 'lookX' | 'lookY' | 'invertY'>) {
  return { yaw: dx * s.lookX, pitch: dy * s.lookY * (s.invertY ? -1 : 1) };
}

/** Stick deflection to movement: dead zone, then 0..1 of walking speed; Run when pushed (nearly) fully. */
export function stickOutput(dx: number, dy: number, radius: number) {
  const len = Math.hypot(dx, dy);
  const dead = 0.15 * radius;
  if (len <= dead) return { forward: 0, right: 0, run: false };
  const mag = Math.min(1, (len - dead) / (radius * 0.85 - dead));
  return { forward: (-dy / len) * mag, right: (dx / len) * mag, run: len >= 0.95 * radius };
}

const K = (code: string, key: string, keyCode: number) => ({ code, key, keyCode });
const FIRE = K('ControlLeft', 'Control', 17);
export const TOUCH_BUTTONS: TouchButton[] = [
  { id: 'fire', label: 'Fire', ...FIRE, side: 'right', hold: true },
  { id: 'jump', label: 'Jump', ...K('KeyE', 'e', 69), side: 'right', hold: true },
  { id: 'crouch', label: 'Crouch', ...K('KeyC', 'c', 67), side: 'right', hold: true },
  { id: 'alt', label: 'Alt', ...K('KeyM', 'm', 77), side: 'right', hold: true },
  { id: 'use', label: 'Use', ...K('Space', ' ', 32), side: 'right', hold: true },
  { id: 'reload', label: 'Reload', ...K('KeyR', 'r', 82), side: 'right' },
  { id: 'weapnext', label: 'Weap ▶', ...K('KeyO', 'o', 79), side: 'right' },
  { id: 'weapprev', label: '◀ Weap', ...K('KeyI', 'i', 73), side: 'right' },
  { id: 'menu', label: 'Menu', ...K('Escape', 'Escape', 27), side: 'left' },
  { id: 'obj', label: 'Obj', ...K('Tab', 'Tab', 9), side: 'left', hold: true },
  { id: 'leanl', label: 'Lean ◀', ...K('KeyF', 'f', 70), side: 'left', hold: true },
  { id: 'leanr', label: 'Lean ▶', ...K('KeyG', 'g', 71), side: 'left', hold: true },
  { id: 'item', label: 'Item', ...K('Enter', 'Enter', 13), side: 'left' },
  { id: 'itemnext', label: 'Item ▶', ...K('KeyX', 'x', 88), side: 'left' },
  { id: 'fire2', label: 'Fire', ...FIRE, side: 'left', hold: true },
];

/** Time between moving the menu pointer to a touch and pressing there (about two frames). */
const MENU_HOVER_MS = 40;
const RUN = K('ShiftLeft', 'Shift', 16);

type KeyDesc = Pick<TouchButton, 'code' | 'key' | 'keyCode'>;

/** Reference-counted key state, so two sources holding one key (two Fire buttons) do not release each other. */
export class KeyInjector {
  private held = new Map<string, { n: number; k: KeyDesc }>();
  constructor(private target: EventTarget = window) {}
  down(k: KeyDesc) {
    const h = this.held.get(k.code);
    if (h) { h.n++; return; }
    this.held.set(k.code, { n: 1, k });
    this.send('keydown', k);
  }
  up(k: KeyDesc) {
    const h = this.held.get(k.code);
    if (!h) return;
    if (--h.n > 0) return;
    this.held.delete(k.code);
    this.send('keyup', k);
  }
  tap(k: KeyDesc) {
    this.down(k);
    setTimeout(() => this.up(k), 60);
  }
  releaseAll() {
    for (const { k } of [...this.held.values()]) this.send('keyup', k);
    this.held.clear();
  }
  get heldCodes() { return [...this.held.keys()]; }
  private send(type: 'keydown' | 'keyup', k: KeyDesc) {
    const ev = new KeyboardEvent(type, { code: k.code, key: k.key, bubbles: true, cancelable: true });
    // legacy fields some SDL builds read
    Object.defineProperty(ev, 'keyCode', { get: () => k.keyCode });
    Object.defineProperty(ev, 'which', { get: () => k.keyCode });
    this.target.dispatchEvent(ev);
  }
}

/** Where the overlay's look and movement go (the engine's Browser_Look / Browser_Move). */
export interface TouchSink {
  look(yawRight: number, pitchDown: number, aimScale: number): void;
  move(forward: number, right: number): void;
}

type Owner =
  | { kind: 'stick'; ox: number; oy: number }
  | { kind: 'look'; x: number; y: number }
  | { kind: 'button'; b: TouchButton; x: number; y: number; look: boolean }
  | { kind: 'menu' }
  | { kind: 'ignored' };

export class TouchControls {
  readonly root: HTMLDivElement;
  private keys: KeyInjector;
  private owners = new Map<number, Owner>();
  private running = false;
  private knob: HTMLDivElement;
  private base: HTMLDivElement;
  private menuMode = false;
  private passive = false;
  private menuAt = { x: 0, y: 0 };
  private menuPress: Promise<void> | null = null;
  /** turn handed to the engine so far, degrees (tests and diagnostics) */
  readonly turned = { yaw: 0, pitch: 0 };

  constructor(private canvas: HTMLCanvasElement, private settings: TouchSettings, private sink: TouchSink,
    keyTarget: EventTarget = window) {
    this.keys = new KeyInjector(keyTarget);
    this.root = document.createElement('div');
    this.root.className = 'touch-root';
    this.root.innerHTML = '<div class="touch-stick-area"></div><div class="touch-look-area"></div>' +
      '<div class="touch-stick-base"><div class="touch-stick-knob"></div></div>';
    this.base = this.root.querySelector('.touch-stick-base')!;
    this.knob = this.root.querySelector('.touch-stick-knob')!;
    for (const b of TOUCH_BUTTONS) {
      const el = document.createElement('button');
      el.type = 'button';
      el.tabIndex = -1;
      el.className = `touch-btn touch-${b.side}`;
      el.textContent = b.label;
      el.dataset.id = b.id;
      el.setAttribute('aria-label', b.label);
      this.root.appendChild(el);
    }
    this.apply(settings);
    window.addEventListener('resize', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.layout());
    this.root.addEventListener('pointerdown', this.onDown, { passive: false });
    this.root.addEventListener('pointermove', this.onMove, { passive: false });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.root.addEventListener(t, this.onUp);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('orientationchange', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
  }

  apply(s: TouchSettings) {
    this.settings = s;
    this.root.style.setProperty('--touch-opacity', String(s.opacity));
    this.root.style.setProperty('--touch-scale', String(s.scale));
    this.root.style.setProperty('--edge-x', `${s.edgeX}px`);
    this.root.style.setProperty('--edge-y', `${s.edgeY}px`);
    this.root.classList.toggle('left-handed', s.leftHanded);
    this.root.classList.toggle('left-fire', s.leftFire);
    this.layout();
  }

  /** Pointers held now, by owner kind (diagnostics, tests). */
  ownership() {
    return [...this.owners.entries()].map(([id, o]) => ({ id, kind: o.kind, button: o.kind === 'button' ? o.b.id : undefined }));
  }

  get heldKeys() { return this.keys.heldCodes; }

  /**
   * Places the two button groups in the thumbs' reach: the right group in an arc around the bottom corner
   * (Fire nearest the thumb), the left group down the side above the movement area. In the black bars beside a
   * 4:3 picture when they fit; in widescreen the right group starts above the ammo display instead of covering it.
   */
  layout() {
    const unit = 56 * this.settings.scale;
    const pic = this.canvas.getBoundingClientRect();
    const wide = pic.height > 0 && pic.width * 3 > pic.height * 4 + 8;
    // the ammo and health displays take the bottom 15% of the 640x480 layout (SPEC-310 HUD elements)
    const lift = wide ? Math.max(0, pic.height * 0.16 - (innerHeight - pic.bottom)) : 0;
    this.root.style.setProperty('--hud-lift', `${Math.round(lift)}px`);
    const bar = Math.max(0, (innerWidth - (innerHeight * 4) / 3) / 2);
    const cols = 3 * unit + 20 + 32 <= bar ? 3 : 2;
    for (const side of ['left', 'right'] as const) {
      const group = TOUCH_BUTTONS.filter((b) => b.side === side && (b.id !== 'fire2' || this.settings.leftFire));
      const sideCols = side === 'left' ? 2 : cols;
      group.forEach((b, i) => {
        const el = this.root.querySelector<HTMLElement>(`[data-id="${b.id}"]`);
        // Fire is bigger and sits in the corner; the others follow in rows
        el?.style.setProperty('--col', String(i % sideCols));
        el?.style.setProperty('--row', String(Math.floor(i / sideCols)));
      });
    }
  }

  /** Invisible overlay (controller play): touches in play do nothing, menus still take the finger. */
  setPassive(on: boolean) {
    if (on === this.passive) return;
    this.releaseAll();
    this.passive = on;
  }

  /** The game's menus are open: the overlay becomes a pointer for them (see the header). */
  setMenuMode(on: boolean) {
    if (on === this.menuMode) return;
    this.releaseAll();
    this.menuMode = on;
    this.root.classList.toggle('menu-mode', on);
  }

  releaseAll() {
    for (const o of this.owners.values()) {
      if (o.kind === 'menu') {
        const { x, y } = this.menuAt;
        void (this.menuPress ?? Promise.resolve()).then(() => this.mouse('pointerup', x, y));
      }
    }
    this.menuPress = null;
    this.owners.clear();
    this.running = false;
    this.sink.move(0, 0);
    this.keys.releaseAll();
    this.base.style.display = 'none';
    for (const el of this.root.querySelectorAll('.touch-btn.active')) el.classList.remove('active');
  }

  private hasOwner(kind: Owner['kind']) {
    for (const o of this.owners.values()) if (o.kind === kind) return true;
    return false;
  }

  private onDown = (e: PointerEvent) => {
    const el = e.target as HTMLElement;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // the overlay covers the screen and tracks pointers by id either way
    }
    const isButton = el.classList.contains('touch-btn');
    if (this.passive && !this.menuMode) {
      this.owners.set(e.pointerId, { kind: 'ignored' });
    } else if (this.menuMode && !(isButton && el.dataset.id === 'menu')) {
      if (this.hasOwner('menu')) {
        this.owners.set(e.pointerId, { kind: 'ignored' });
        return;
      }
      this.owners.set(e.pointerId, { kind: 'menu' });
      this.menuAt = { x: e.clientX, y: e.clientY };
      this.mouse('pointermove', e.clientX, e.clientY);
      // the menus click the item the pointer hovered in the previous frame: let a frame or two pass first
      this.menuPress = new Promise((resolve) => setTimeout(() => {
        this.mouse('pointerdown', this.menuAt.x, this.menuAt.y);
        resolve();
      }, MENU_HOVER_MS));
    } else if (isButton) {
      const b = TOUCH_BUTTONS.find((x) => x.id === el.dataset.id)!;
      el.classList.add('active');
      if (b.hold) {
        this.owners.set(e.pointerId, { kind: 'button', b, x: e.clientX, y: e.clientY, look: b.id === 'fire' && this.settings.fireLook });
        this.keys.down(b);
      } else {
        this.owners.set(e.pointerId, { kind: 'ignored' });
        this.keys.tap(b);
        setTimeout(() => el.classList.remove('active'), 120);
      }
    } else if (el.classList.contains('touch-stick-area') && !this.hasOwner('stick')) {
      this.owners.set(e.pointerId, { kind: 'stick', ox: e.clientX, oy: e.clientY });
      this.base.style.display = 'block';
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
    } else if (el.classList.contains('touch-look-area') && !this.hasOwner('look')) {
      this.owners.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY });
    } else {
      // a second finger on an area that already has one: it does nothing until lifted
      this.owners.set(e.pointerId, { kind: 'ignored' });
    }
  };

  private onMove = (e: PointerEvent) => {
    const o = this.owners.get(e.pointerId);
    if (!o) return;
    e.preventDefault();
    if (o.kind === 'menu') {
      this.menuAt = { x: e.clientX, y: e.clientY };
      this.mouse('pointermove', e.clientX, e.clientY);
    } else if (o.kind === 'stick') {
      const r = 60 * this.settings.scale;
      let dx = e.clientX - o.ox;
      let dy = e.clientY - o.oy;
      const out = stickOutput(dx, dy, r);
      const len = Math.hypot(dx, dy);
      if (len > r) { dx = (dx / len) * r; dy = (dy / len) * r; }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.sink.move(out.forward, out.right);
      if (out.run !== this.running) {
        this.running = out.run;
        if (out.run) this.keys.down(RUN); else this.keys.up(RUN);
      }
    } else if (o.kind === 'look' || (o.kind === 'button' && o.look)) {
      // the travel since this finger's previous event, handed over once
      const dx = e.clientX - o.x;
      const dy = e.clientY - o.y;
      o.x = e.clientX;
      o.y = e.clientY;
      if (!dx && !dy) return;
      const { yaw, pitch } = lookDegrees(dx, dy, this.settings);
      this.turned.yaw += yaw;
      this.turned.pitch += pitch;
      this.sink.look(yaw, pitch, this.settings.aimScale);
    }
  };

  private onUp = (e: PointerEvent) => {
    const o = this.owners.get(e.pointerId);
    if (!o) return;
    this.owners.delete(e.pointerId);
    if (o.kind === 'menu') {
      const { clientX: x, clientY: y } = e;
      const press = this.menuPress;
      this.menuPress = null;
      // the release always follows the delayed press, a frame or two later; a cancelled touch does not click
      void press?.then(() => setTimeout(() => {
        if (e.type === 'pointerup') this.mouse('pointermove', x, y);
        this.mouse('pointerup', e.type === 'pointerup' ? x : -1, e.type === 'pointerup' ? y : -1);
      }, MENU_HOVER_MS));
    } else if (o.kind === 'stick') {
      this.sink.move(0, 0);
      if (this.running) { this.running = false; this.keys.up(RUN); }
      this.base.style.display = 'none';
    } else if (o.kind === 'button') {
      this.keys.up(o.b);
      this.root.querySelector(`[data-id="${o.b.id}"]`)?.classList.remove('active');
    }
  };

  /** The engine's SDL layer reads the menu pointer from pointer events of type "mouse" on the canvas. */
  private mouse(type: 'pointermove' | 'pointerdown' | 'pointerup', x: number, y: number) {
    this.canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y,
      button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerdown' ? 1 : 0,
      bubbles: true, cancelable: true, view: window,
    }));
  }
}
