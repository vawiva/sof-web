// Landscape-only play on phones and tablets. The startup page works in any orientation; the game itself only in
// landscape: in portrait a rotate screen covers it (no game controls on it). A single-player game is paused and
// needs a tap to resume after rotating back; a multiplayer game cannot be paused (the server keeps running), so
// it is only covered and the local inputs are released.
//
// Orientation lock is asked for where the browser offers it (usually only in fullscreen, on Android); a refusal
// is expected and harmless: the rotate screen is the requirement, the lock only a convenience.

/** A touch-first device (phone, tablet): the only kind that must be held in landscape to play. */
export function isHandheld(mm: (q: string) => boolean = (q) => matchMedia(q).matches): boolean {
  return mm('(pointer: coarse)') && !mm('(any-pointer: fine)');
}

/** Whether play must wait: a handheld device in portrait (taller than wide). */
export function mustRotate(handheld: boolean, width: number, height: number): boolean {
  return handheld && height > width;
}

export async function lockLandscape(): Promise<'locked' | 'unsupported' | 'refused'> {
  const o = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> };
  if (!o?.lock) return 'unsupported';
  try {
    await o.lock('landscape');
    return 'locked';
  } catch {
    return 'refused';
  }
}

/** Resolves when the viewport is landscape (or the device is not handheld). */
export function untilLandscape(handheld: () => boolean, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!mustRotate(handheld(), innerWidth, innerHeight)) { done(); resolve(); }
    };
    const done = () => {
      removeEventListener('resize', check);
      screen.orientation?.removeEventListener?.('change', check);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => { done(); reject(new DOMException('Aborted', 'AbortError')); };
    addEventListener('resize', check);
    screen.orientation?.addEventListener?.('change', check);
    signal?.addEventListener('abort', abort);
    check();
  });
}

export interface GameControl {
  /** what the engine is doing now (null when it is not running) */
  state(): { inLevel: boolean; multiplayer: boolean; paused: boolean } | null;
  pause(on: boolean): void;
  releaseInputs(): void;
}

/**
 * Watches the orientation during play. Portrait: release inputs, pause a single-player level (only if it was
 * not paused already), show the rotate screen. Landscape again: hide it; if this guard paused the game, ask for a
 * tap before resuming, so a thumb resting on the screen does not fire or move at once.
 * Returning from the background on a handheld also pauses a running single-player level until a tap.
 */
export class LandscapeGuard {
  private pausedByUs = false;
  private covered = false;

  constructor(private game: GameControl, private ui: { rotate: HTMLElement; resume: HTMLElement; note: HTMLElement },
    private handheld: () => boolean = () => isHandheld()) {
    const check = () => this.check();
    addEventListener('resize', check);
    screen.orientation?.addEventListener?.('change', check);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.handheld()) this.hold();
      else this.check();
    });
    ui.resume.addEventListener('click', () => this.resume());
    this.check();
  }

  get isCovered() { return this.covered; }

  check() {
    if (mustRotate(this.handheld(), innerWidth, innerHeight)) {
      if (!this.covered) {
        this.covered = true;
        const st = this.hold();
        this.ui.note.textContent = st?.multiplayer
          ? 'Multiplayer keeps running: your player stands still until you rotate back.'
          : st?.inLevel ? 'The game is paused.' : '';
      }
      this.ui.rotate.hidden = false;
      this.ui.resume.hidden = true;
    } else if (this.covered) {
      this.covered = false;
      this.ui.rotate.hidden = true;
      if (this.pausedByUs) this.ui.resume.hidden = false;
    }
  }

  /** Releases inputs and pauses a running single-player level. */
  private hold() {
    this.game.releaseInputs();
    const st = this.game.state();
    if (st?.inLevel && !st.multiplayer && !st.paused) {
      this.game.pause(true);
      this.pausedByUs = true;
    }
    if (this.pausedByUs && !this.covered) this.ui.resume.hidden = false;
    return st;
  }

  resume() {
    this.ui.resume.hidden = true;
    this.game.releaseInputs();
    if (this.pausedByUs) {
      this.pausedByUs = false;
      this.game.pause(false);
    }
  }
}
