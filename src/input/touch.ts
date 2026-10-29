// Touch controls for the running game. The engine consumes keyboard and mouse events (via SDL),
// so this overlay translates touches into the same physical-key and mouse events:
//  - left stick: digital W/A/S/D like the original keyboard movement, Shift when pushed fully
//  - right area: drag = relative mouse look; a short tap = mouse click at that point (menus)
//  - buttons: hold-able keys for the game's commands
//  - while one of the game's own menus is open, the stick and buttons step aside (only Menu stays, as the
//    menus' back key) and a finger is the mouse pointer: touching moves the menu cursor there, lifting clicks
// Every pointer is tracked by id; releasing, cancelling or losing focus releases what it held.

export interface TouchButton {
  id: string;
  label: string;
  code: string;      // KeyboardEvent.code sent to the engine
  key: string;       // KeyboardEvent.key
  keyCode: number;   // legacy keyCode, still read by some SDL paths
  side: 'left' | 'right';
  row: number;
  col: number;
  hold?: boolean;    // held while touched (otherwise a tap)
}

export interface TouchSettings {
  opacity: number;   // 0.15 - 1
  scale: number;     // 0.75 - 1.5
  leftHanded: boolean;
  lookSensitivity: number; // pixels of mouse movement per pixel of drag
  invertLook: boolean;
}

export const DEFAULT_TOUCH: TouchSettings = { opacity: 0.55, scale: 1, leftHanded: false, lookSensitivity: 1.6, invertLook: false };

const K = (code: string, key: string, keyCode: number) => ({ code, key, keyCode });
export const TOUCH_BUTTONS: TouchButton[] = [
  { id: 'fire', label: 'Fire', ...K('ControlLeft', 'Control', 17), side: 'right', row: 0, col: 0, hold: true },
  { id: 'alt', label: 'Alt', ...K('KeyM', 'm', 77), side: 'right', row: 1, col: 0, hold: true },
  { id: 'jump', label: 'Jump', ...K('KeyE', 'e', 69), side: 'right', row: 0, col: 1, hold: true },
  { id: 'crouch', label: 'Crouch', ...K('KeyC', 'c', 67), side: 'right', row: 1, col: 1, hold: true },
  { id: 'use', label: 'Use', ...K('Space', ' ', 32), side: 'right', row: 0, col: 2, hold: true },
  { id: 'reload', label: 'Reload', ...K('KeyR', 'r', 82), side: 'right', row: 1, col: 2 },
  { id: 'weapnext', label: 'Weap ▶', ...K('KeyO', 'o', 79), side: 'right', row: 2, col: 1 },
  { id: 'weapprev', label: '◀ Weap', ...K('KeyI', 'i', 73), side: 'right', row: 2, col: 2 },
  { id: 'leanl', label: 'Lean ◀', ...K('KeyF', 'f', 70), side: 'left', row: 0, col: 0, hold: true },
  { id: 'leanr', label: 'Lean ▶', ...K('KeyG', 'g', 71), side: 'left', row: 0, col: 1, hold: true },
  { id: 'item', label: 'Item', ...K('Enter', 'Enter', 13), side: 'left', row: 1, col: 0 },
  { id: 'itemnext', label: 'Item ▶', ...K('KeyX', 'x', 88), side: 'left', row: 1, col: 1 },
  { id: 'obj', label: 'Obj', ...K('Tab', 'Tab', 9), side: 'left', row: 2, col: 0, hold: true },
  { id: 'menu', label: 'Menu', ...K('Escape', 'Escape', 27), side: 'left', row: 2, col: 1 },
];

/** Time between moving the menu pointer to a touch and pressing there (about two frames). */
const MENU_HOVER_MS = 40;

type KeyDesc = Pick<TouchButton, 'code' | 'key' | 'keyCode'>;
const MOVE: Record<'up' | 'down' | 'left' | 'right' | 'run', KeyDesc> = {
  up: K('KeyW', 'w', 87), down: K('KeyS', 's', 83), left: K('KeyA', 'a', 65), right: K('KeyD', 'd', 68),
  run: K('ShiftLeft', 'Shift', 16),
};

/** Reference-counted key state, so two sources holding one key do not release each other. */
export class KeyInjector {
  private held = new Map<string, number>();
  constructor(private target: EventTarget = window) {}
  down(k: KeyDesc) {
    const n = this.held.get(k.code) ?? 0;
    this.held.set(k.code, n + 1);
    if (n === 0) this.send('keydown', k);
  }
  up(k: KeyDesc) {
    const n = this.held.get(k.code) ?? 0;
    if (n <= 0) return;
    if (n === 1) {
      this.held.delete(k.code);
      this.send('keyup', k);
    } else this.held.set(k.code, n - 1);
  }
  tap(k: KeyDesc) {
    this.down(k);
    setTimeout(() => this.up(k), 60);
  }
  releaseAll() {
    for (const code of [...this.held.keys()]) {
      this.held.set(code, 1);
      const k = [...TOUCH_BUTTONS, ...Object.values(MOVE)].find((b) => b.code === code);
      if (k) this.up(k);
    }
    this.held.clear();
  }
  private send(type: 'keydown' | 'keyup', k: KeyDesc) {
    const ev = new KeyboardEvent(type, { code: k.code, key: k.key, bubbles: true, cancelable: true });
    // legacy fields some SDL builds read
    Object.defineProperty(ev, 'keyCode', { get: () => k.keyCode });
    Object.defineProperty(ev, 'which', { get: () => k.keyCode });
    this.target.dispatchEvent(ev);
  }
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private keys: KeyInjector;
  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickDirs = new Set<keyof typeof MOVE>();
  private lookPointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; moved: boolean }>();
  private buttonPointers = new Map<number, TouchButton>();
  private knob: HTMLDivElement;
  private base: HTMLDivElement;
  private menuMode = false;
  private menuPointer: number | null = null;
  private menuAt = { x: 0, y: 0 };
  private menuPress: Promise<void> | null = null;

  constructor(private canvas: HTMLCanvasElement, private settings: TouchSettings, keyTarget: EventTarget = window) {
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
      el.className = `touch-btn touch-${b.side}`;
      el.textContent = b.label;
      el.dataset.id = b.id;
      el.style.setProperty('--row', String(b.row));
      el.style.setProperty('--col', String(b.col));
      el.setAttribute('aria-label', b.label);
      this.root.appendChild(el);
    }
    this.apply(settings);
    window.addEventListener('resize', () => this.layout());
    this.root.addEventListener('pointerdown', this.onDown, { passive: false });
    this.root.addEventListener('pointermove', this.onMove, { passive: false });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.root.addEventListener(t, this.onUp);
    }
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
  }

  apply(s: TouchSettings) {
    this.settings = s;
    this.root.style.setProperty('--touch-opacity', String(s.opacity));
    this.root.style.setProperty('--touch-scale', String(s.scale));
    this.root.classList.toggle('left-handed', s.leftHanded);
    this.layout();
  }

  /**
   * Fits each button group into the black bar beside the 4:3 picture: as many columns (3, else 2) as the bar
   * holds, filled in TOUCH_BUTTONS order (the most used buttons nearest the screen corner), growing in rows.
   * Where even two columns do not fit (narrow or portrait screens) the groups overlap the picture's edge.
   */
  layout() {
    const unit = 56 * this.settings.scale;
    const bar = Math.max(0, (innerWidth - (innerHeight * 4) / 3) / 2);
    const fits = (cols: number) => cols * unit + (cols - 1) * 10 + 32 <= bar;
    const cols = fits(3) ? 3 : 2;
    for (const side of ['left', 'right'] as const) {
      const group = TOUCH_BUTTONS.filter((b) => b.side === side);
      const sideCols = side === 'left' ? Math.min(cols, 2) : cols;
      group.forEach((b, i) => {
        const el = this.root.querySelector<HTMLElement>(`[data-id="${b.id}"]`);
        el?.style.setProperty('--col', String(i % sideCols));
        el?.style.setProperty('--row', String(Math.floor(i / sideCols)));
      });
    }
  }

  /** The game's menus are open: the overlay becomes a pointer for them (see the header). */
  setMenuMode(on: boolean) {
    if (on === this.menuMode) return;
    this.releaseAll();
    this.menuMode = on;
    this.root.classList.toggle('menu-mode', on);
  }

  releaseAll() {
    if (this.menuPointer !== null) {
      const { x, y } = this.menuAt;
      void (this.menuPress ?? Promise.resolve()).then(() => this.mouse('pointerup', x, y, 0, 0));
    }
    this.menuPointer = null;
    this.menuPress = null;
    this.stickPointer = null;
    this.stickDirs.clear();
    this.lookPointers.clear();
    this.buttonPointers.clear();
    this.keys.releaseAll();
    this.base.style.display = 'none';
    for (const el of this.root.querySelectorAll('.touch-btn.active')) el.classList.remove('active');
  }

  private onDown = (e: PointerEvent) => {
    const el = e.target as HTMLElement;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // refused while the engine holds pointer lock; the overlay covers the screen and tracks pointers by id
    }
    if (this.menuMode && !el.classList.contains('touch-btn')) {
      if (this.menuPointer !== null) return;
      this.menuPointer = e.pointerId;
      this.menuAt = { x: e.clientX, y: e.clientY };
      this.mouse('pointermove', e.clientX, e.clientY, 0, 0);
      // the menus click the item the pointer hovered in the previous frame: let a frame or two pass first
      this.menuPress = new Promise((resolve) => setTimeout(() => {
        this.mouse('pointerdown', this.menuAt.x, this.menuAt.y, 0, 0);
        resolve();
      }, MENU_HOVER_MS));
    } else if (el.classList.contains('touch-btn')) {
      const b = TOUCH_BUTTONS.find((x) => x.id === el.dataset.id)!;
      el.classList.add('active');
      if (b.hold) {
        this.buttonPointers.set(e.pointerId, b);
        this.keys.down(b);
      } else {
        this.keys.tap(b);
        setTimeout(() => el.classList.remove('active'), 120);
      }
    } else if (el.classList.contains('touch-stick-area') && this.stickPointer === null) {
      this.stickPointer = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.base.style.display = 'block';
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
    } else if (el.classList.contains('touch-look-area')) {
      this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
    }
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId === this.menuPointer) {
      e.preventDefault();
      this.menuAt = { x: e.clientX, y: e.clientY };
      this.mouse('pointermove', e.clientX, e.clientY, 0, 0);
      return;
    }
    if (e.pointerId === this.stickPointer) {
      e.preventDefault();
      const r = 60 * this.settings.scale;
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > r) { dx = (dx / len) * r; dy = (dy / len) * r; }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const dead = 0.3 * r;
      const want = new Set<keyof typeof MOVE>();
      if (len > dead) {
        const a = Math.atan2(dy, dx); // 8-way sectors like keyboard diagonals
        const s = Math.round(a / (Math.PI / 4));
        if ([-3, -2, -1].includes(s)) want.add('up');
        if ([1, 2, 3].includes(s)) want.add('down');
        if ([3, 4, -4, -3].includes(s)) want.add('left');
        if ([-1, 0, 1].includes(s)) want.add('right');
        if (len >= 0.95 * r) want.add('run');
      }
      for (const d of this.stickDirs) if (!want.has(d)) this.keys.up(MOVE[d]);
      for (const d of want) if (!this.stickDirs.has(d)) this.keys.down(MOVE[d]);
      this.stickDirs = want;
      return;
    }
    const p = this.lookPointers.get(e.pointerId);
    if (p) {
      e.preventDefault();
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) p.moved = true;
      const k = this.settings.lookSensitivity;
      this.mouse('pointermove', e.clientX, e.clientY, dx * k, dy * k * (this.settings.invertLook ? -1 : 1));
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId === this.menuPointer) {
      this.menuPointer = null;
      const { clientX: x, clientY: y } = e;
      const press = this.menuPress;
      this.menuPress = null;
      // the release always follows the delayed press, a frame or two later
      void press?.then(() => setTimeout(() => {
        this.mouse('pointermove', x, y, 0, 0);
        this.mouse('pointerup', x, y, 0, 0);
      }, MENU_HOVER_MS));
      return;
    }
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = null;
      for (const d of this.stickDirs) this.keys.up(MOVE[d]);
      this.stickDirs.clear();
      this.base.style.display = 'none';
      return;
    }
    const b = this.buttonPointers.get(e.pointerId);
    if (b) {
      this.buttonPointers.delete(e.pointerId);
      this.keys.up(b);
      this.root.querySelector(`[data-id="${b.id}"]`)?.classList.remove('active');
      return;
    }
    const p = this.lookPointers.get(e.pointerId);
    if (p) {
      this.lookPointers.delete(e.pointerId);
      // a short, still touch is a click (menus, dialogue choices)
      if (e.type === 'pointerup' && !p.moved && performance.now() - p.t < 350) {
        this.mouse('pointermove', e.clientX, e.clientY, 0, 0);
        this.mouse('pointerdown', e.clientX, e.clientY, 0, 0);
        this.mouse('pointerup', e.clientX, e.clientY, 0, 0);
      }
    }
  };

  /** The engine's SDL layer reads mouse input from pointer events of type "mouse" on the canvas. */
  private mouse(type: 'pointermove' | 'pointerdown' | 'pointerup', x: number, y: number, mx: number, my: number) {
    this.canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
      clientX: x, clientY: y, movementX: mx, movementY: my,
      button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerdown' ? 1 : 0,
      bubbles: true, cancelable: true, view: window,
    }));
  }
}
