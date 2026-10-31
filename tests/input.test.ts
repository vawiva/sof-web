import { describe, expect, it } from 'vitest';
import { Calibration, detectAxis, detectButton } from '../src/input/calibrate';
import { GamepadAdapter, type RawPad, activity, defaultProfile, normalize, padActions, virtualPad } from '../src/input/gamepad';
import { DEFAULT_TOUCH, lookDegrees, parseTouch, stickOutput } from '../src/input/touch';
import { mustRotate } from '../src/app/orientation';

const btn = (pressed = false, value = pressed ? 1 : 0) => ({ pressed, value });
function pad(o: Partial<RawPad> & { nb?: number; na?: number } = {}): RawPad {
  return {
    id: o.id ?? 'Test pad (STANDARD GAMEPAD Vendor: 045e Product: 02ea)', index: o.index ?? 0, mapping: o.mapping ?? 'standard',
    connected: true, timestamp: o.timestamp ?? 1,
    axes: o.axes ?? Array(o.na ?? 4).fill(0), buttons: o.buttons ?? Array.from({ length: o.nb ?? 17 }, () => btn()),
  };
}

describe('controller mapping', () => {
  it('uses the browser layout for standard controllers', () => {
    const p = defaultProfile(pad());
    expect(p.axes.map((a) => a?.a)).toEqual([0, 1, 2, 3]);
    expect(p.buttons[7]).toEqual({ b: 7 });
  });

  it('guesses the right stick and hat of a common non-standard layout', () => {
    const p = defaultProfile(pad({ mapping: '', na: 8, nb: 12 }));
    expect(p.axes[2]).toEqual({ a: 3, invert: false });
    expect(p.axes[3]).toEqual({ a: 4, invert: false });
    expect(p.buttons[12]).toEqual({ a: 7, dir: -1 }); // d-pad up = hat y negative
  });

  it('subtracts stick centres and still reaches full travel', () => {
    const p = defaultProfile(pad());
    p.centers = [0.1, 0, 0, 0];
    expect(normalize(pad({ axes: [0.1, 0, 0, 0] }), p).axes[0]).toBeCloseTo(0);
    expect(normalize(pad({ axes: [1, 0, 0, 0] }), p).axes[0]).toBeCloseTo(1);
    expect(normalize(pad({ axes: [-1, 0, 0, 0] }), p).axes[0]).toBeCloseTo(-1);
  });

  it('inverts mapped axes and reads half axes as buttons', () => {
    const p = defaultProfile(pad({ mapping: '', na: 8, nb: 12 }));
    p.axes[1] = { a: 1, invert: true };
    const n = normalize(pad({ mapping: '', axes: [0, 0.5, 0, 0, 0, 0, 0, -1], nb: 12 }), p);
    expect(n.axes[1]).toBeCloseTo(-0.5);
    expect(n.buttons[12]).toBe(1);
    expect(n.buttons[13]).toBe(0);
  });

  it('does not count stick drift as use', () => {
    expect(activity(pad({ axes: [0.12, -0.2, 0.08, 0] }))).toBe(false);
    expect(activity(pad({ axes: [0.9, 0, 0, 0] }))).toBe(true);
    expect(activity(pad({ buttons: [btn(true), ...Array.from({ length: 16 }, () => btn())] }))).toBe(true);
  });

  it('hands the engine a standard controller with analog triggers', () => {
    const raw = pad({ buttons: Array.from({ length: 17 }, (_, i) => (i === 7 ? btn(false, 0.3) : btn())) });
    const v = virtualPad(raw, defaultProfile(raw), 5);
    expect(v.mapping).toBe('standard');
    expect(v.buttons).toHaveLength(17);
    expect(v.buttons[7]).toMatchObject({ value: 0.3, pressed: true });
  });

  it('names the game actions of a controller state', () => {
    const b = Array(17).fill(0);
    b[7] = 1;
    b[0] = 1;
    expect(padActions([0, -1, 0.8, 0], b, 0.16)).toEqual(['move forward', 'look right', 'jump', 'fire']);
  });
});

describe('controller adapter', () => {
  function fakeWindow(list: Array<RawPad | null>) {
    const win = Object.assign(new EventTarget(), {
      navigator: { getGamepads: () => list }, requestAnimationFrame: () => 0, isSecureContext: true,
    });
    const seen: string[] = [];
    // registered after the adapter, as the engine's listeners are
    return { win, seen, listen: () => {
      for (const t of ['gamepadconnected', 'gamepaddisconnected']) win.addEventListener(t, (e) => seen.push(`${t}:${(e as Event & { gamepad?: { index: number } }).gamepad?.index}`));
    } };
  }

  it('shows one virtual controller and announces it once', () => {
    const raw = pad({ index: 2, buttons: [btn(true), ...Array.from({ length: 16 }, () => btn())] });
    const f = fakeWindow([null, null, raw]);
    const a = new GamepadAdapter(f.win as unknown as Window & typeof globalThis);
    f.listen();
    const list = (f.win.navigator as { getGamepads: () => unknown[] }).getGamepads();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ index: 0, mapping: 'standard' });
    a.update();
    expect(f.seen).toEqual(['gamepadconnected:0']);
  });

  it('swallows the browser events and follows disconnect and reconnect', () => {
    const raw = pad({ buttons: [btn(true), ...Array.from({ length: 16 }, () => btn())] });
    const list: Array<RawPad | null> = [raw];
    const f = fakeWindow(list);
    const a = new GamepadAdapter(f.win as unknown as Window & typeof globalThis);
    f.listen();
    a.update();
    const browserEvent = Object.assign(new Event('gamepadconnected'), { gamepad: raw });
    f.win.dispatchEvent(browserEvent);
    expect(f.seen).toEqual(['gamepadconnected:0']); // the browser's own event did not reach the engine
    list[0] = null;
    a.update();
    expect(f.seen).toEqual(['gamepadconnected:0', 'gamepaddisconnected:0']);
    list[0] = { ...raw, index: 1 };
    a.update();
    expect(f.seen.at(-1)).toBe('gamepadconnected:0');
    expect(a.status().active?.index).toBe(1);
  });

  it('hands over a connected controller at once, preferring the one in use (auto)', () => {
    const idle = pad({ id: 'idle', axes: [0.1, 0, 0, 0] });
    const used = pad({ id: 'used', index: 1, axes: [0, 0.9, 0, 0] });
    let a = new GamepadAdapter(fakeWindow([idle]).win as unknown as Window & typeof globalThis);
    a.update();
    expect(a.status().active?.id).toBe('idle');
    a = new GamepadAdapter(fakeWindow([idle, used]).win as unknown as Window & typeof globalThis);
    a.update();
    expect(a.status().active?.id).toBe('used');
  });

  it('uses the chosen controller only', () => {
    const one = pad({ id: 'one', buttons: [btn(true), ...Array.from({ length: 16 }, () => btn())] });
    const two = pad({ id: 'two', index: 1 });
    const f = fakeWindow([one, two]);
    const a = new GamepadAdapter(f.win as unknown as Window & typeof globalThis, 'two');
    a.update();
    expect(a.status().active?.id).toBe('two');
  });
});

describe('calibration', () => {
  it('maps a non-standard controller from recorded presses', () => {
    const base = pad({ mapping: '', axes: [0.05, -0.02, 0, 0, 0, -1], nb: 12 });
    const cal = new Calibration(base);
    expect(cal.sample(base)).toBe(true); // centres
    const with_ = (axes: number[], pressed = -1) => ({ ...base, axes, buttons: base.buttons.map((_, i) => btn(i === pressed)) });
    expect(cal.sample(with_([0.05, -0.02, 0.98, 0, 0, -1]))).toBe(true); // left stick right is axis 2
    expect(cal.sample(with_([0.05, -0.02, 0, -0.95, 0, -1]))).toBe(true); // left stick down is axis 3, reversed
    expect(cal.sample(with_([1, -0.02, 0, 0, 0, -1]))).toBe(true); // right stick right is axis 0
    expect(cal.sample(with_([0.05, 1, 0, 0, 0, -1]))).toBe(true); // right stick down is axis 1
    expect(cal.profile.axes).toEqual([{ a: 2, invert: false }, { a: 3, invert: true }, { a: 0, invert: false }, { a: 1, invert: false }]);
    expect(cal.sample(with_([0.05, -0.02, 0, 0, 0, -1], 3))).toBe(true); // A is button 3
    expect(cal.profile.buttons[0]).toEqual({ b: 3 });
    expect(cal.sample(with_([0.05, -0.02, 0, 0, 0, -1]))).toBe(false); // nothing pressed: the step stays
    expect(cal.sample(with_([0.05, -0.02, 0, 0, 0, 1]))).toBe(true); // B is a trigger axis (resting at -1)
    expect(cal.profile.buttons[1]).toEqual({ a: 5, dir: 1 });
  });

  it('ignores small movements', () => {
    expect(detectAxis([0, 0], { axes: [0.3, -0.2] })).toBeNull();
    expect(detectButton([0, 0], { axes: [0.3, 0], buttons: [btn()] }, [])).toBeNull();
  });
});

describe('touch look and movement', () => {
  it('turns by finger travel, not by screen position or time', () => {
    const s = { ...DEFAULT_TOUCH, lookX: 0.3, lookY: 0.25 };
    // one 100 px swipe in one event or in many small ones: the same turn
    const whole = lookDegrees(100, 40, s);
    let yaw = 0;
    let pitch = 0;
    for (let i = 0; i < 20; i++) { const d = lookDegrees(5, 2, s); yaw += d.yaw; pitch += d.pitch; }
    expect(yaw).toBeCloseTo(whole.yaw);
    expect(pitch).toBeCloseTo(whole.pitch);
    expect(whole).toEqual({ yaw: 30, pitch: 10 });
    expect(lookDegrees(0, 40, { ...s, invertY: true }).pitch).toBe(-10);
  });

  it('gives analog movement with a dead zone and run at full push', () => {
    expect(stickOutput(5, 0, 60)).toEqual({ forward: 0, right: 0, run: false });
    const half = stickOutput(0, -30, 60);
    expect(half.forward).toBeGreaterThan(0.3);
    expect(half.forward).toBeLessThan(0.7);
    expect(half.run).toBe(false);
    const full = stickOutput(60, 0, 60);
    expect(full.right).toBe(1);
    expect(full.run).toBe(true);
  });

  it('reads stored settings from earlier versions and clamps them', () => {
    const s = parseTouch({ lookSensitivity: 3, invertLook: true, scale: 9 });
    expect(s.invertY).toBe(true);
    expect(s.scale).toBe(1.5);
    expect(s.lookX).toBe(DEFAULT_TOUCH.lookX);
  });
});

describe('landscape-only play', () => {
  it('asks handheld devices in portrait to rotate', () => {
    expect(mustRotate(true, 400, 800)).toBe(true);
    expect(mustRotate(true, 800, 400)).toBe(false);
    expect(mustRotate(false, 400, 800)).toBe(false);
  });
});
