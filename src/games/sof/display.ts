// Browser display settings: the picture's shape (original 4:3 by default, opt-in widescreen) and the frame-rate
// target. Both are page settings, read once when the game starts.
//
// Widescreen: the engine keeps the height of the original resolution rows and widens the 3D view (openMERC's
// horplus keeps the original vertical field of view, so the picture shows more at the sides and nothing is
// cropped or stretched); menus, fonts and the crosshair keep their 640x480 proportions in a centred 4:3 area,
// and scripted cinematics keep their 4:3 framing (engine patch, cl_screen.c).
//
// Frame rate: rendering follows the browser's animation frames; the engine's own timing keeps the simulation
// (10 Hz server frames, msec-based movement, animation) independent of how often a picture is drawn.

export type AspectSetting = '4:3' | '16:9' | 'fill';
export type FpsSetting = '60' | 'display' | '30';

export interface DisplaySettings {
  aspect: AspectSetting;
  fps: FpsSetting;
}

export const DEFAULT_DISPLAY: DisplaySettings = { aspect: '4:3', fps: '60' };

/** The widest picture accepted for "fill the screen" (wider phones get black bars at the sides). */
export const MAX_ASPECT = 2.4;

export function parseDisplay(raw: unknown): DisplaySettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof DisplaySettings, unknown>>;
  const aspect = (['4:3', '16:9', 'fill'] as const).find((a) => a === o.aspect) ?? DEFAULT_DISPLAY.aspect;
  const fps = (['60', 'display', '30'] as const).find((f) => f === o.fps) ?? DEFAULT_DISPLAY.fps;
  return { aspect, fps };
}

/** The picture's width / height for a setting and the space available (CSS pixels). */
export function pictureAspect(setting: AspectSetting, width: number, height: number): number {
  if (setting === '16:9') return 16 / 9;
  if (setting === 'fill' && width > 0 && height > 0) return Math.min(MAX_ASPECT, Math.max(4 / 3, width / height));
  return 4 / 3;
}

/** The largest box of `aspect` inside width x height. */
export function fitBox(aspect: number, width: number, height: number): { width: number; height: number } {
  return { width: Math.round(Math.min(width, height * aspect)), height: Math.round(Math.min(height, width / aspect)) };
}

/** Engine frame-rate target (Module.frameCap): 0 = every display frame. */
export function frameCap(setting: FpsSetting, displayHz: number): number {
  if (setting === 'display') return 0;
  const cap = setting === '30' ? 30 : 60;
  // a display that is not faster than the target needs no schedule (it would only drop frames to jitter)
  return displayHz > 0 && displayHz <= cap + 2 ? 0 : cap;
}

const COMMON_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 360];

/** A display refresh rate from measured animation-frame intervals (ms); 0 when they say nothing useful. */
export function refreshFromIntervals(intervals: number[]): number {
  const good = intervals.filter((d) => d > 2 && d < 100).sort((a, b) => a - b);
  if (good.length < 8) return 0;
  const hz = 1000 / good[Math.floor(good.length / 2)];
  const near = COMMON_RATES.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a));
  return Math.abs(near - hz) <= near * 0.04 ? near : Math.round(hz);
}

/** Measures the display's refresh rate from animation frames (resolves 0 in a hidden tab or after `timeoutMs`). */
export function measureRefresh(frames = 40, timeoutMs = 1500): Promise<number> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let last = 0;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(refreshFromIntervals(intervals)); } };
    const step = (t: number) => {
      if (done) return;
      if (last) intervals.push(t - last);
      last = t;
      if (intervals.length >= frames) finish();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(finish, timeoutMs);
  });
}
