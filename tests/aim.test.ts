import { describe, expect, it } from 'vitest';
import { PAD_DEFAULTS, TOUCH_LOOK_DEFAULTS, migratePad, migrateTouchLook, padCvars, parsePad } from '../src/input/aim';
import { installState } from '../src/app/install';

describe('aiming defaults and stored profiles', () => {
  it('moves untouched old touch look speeds to the new defaults and keeps chosen ones', () => {
    // version 1 stored the whole settings object; 0.3 / 0.25 were its defaults
    expect(migrateTouchLook({ lookX: 0.3, lookY: 0.25, opacity: 0.8 }, 1)).toEqual({ value: { opacity: 0.8 }, custom: [] });
    const m = migrateTouchLook({ lookX: 0.6, lookY: 0.25 }, 1);
    expect(m.value).toEqual({ lookX: 0.6 });
    expect(m.custom).toEqual(['lookX']);
    // version 2: a value equal to an old default was chosen deliberately and stays
    expect(migrateTouchLook({ lookX: 0.3 }, 2)).toEqual({ value: { lookX: 0.3 }, custom: ['lookX'] });
    expect(migrateTouchLook({ ...TOUCH_LOOK_DEFAULTS }, 2).custom).toEqual([]);
  });

  it('moves untouched old controller speeds to the new defaults and keeps chosen ones', () => {
    expect(migratePad({ yaw: 160, pitch: 120, dead: 0.16, choice: 'auto' }, 1)).toEqual({ value: { ...PAD_DEFAULTS }, custom: [] });
    const m = migratePad({ yaw: 250, pitch: 120, dead: 0.16, invertY: true }, 1);
    expect(m.value).toMatchObject({ yaw: 250, pitch: PAD_DEFAULTS.pitch, dead: PAD_DEFAULTS.dead, invertY: true });
    expect(m.custom).toEqual(['yaw']);
  });

  it('sets the engine without hidden edge acceleration unless chosen', () => {
    const c = padCvars(PAD_DEFAULTS);
    expect(c).toContain('set joy_yawspeed 330');
    expect(c).toContain('set joy_right_expo 1.5');
    expect(c).toContain('set joy_extra_yawspeed 0');
    expect(padCvars({ ...PAD_DEFAULTS, boost: true, invertY: true, curve: 'linear' })).toMatch(/joy_pitchspeed -220.*joy_right_expo 1;.*joy_extra_yawspeed 220/);
    expect(parsePad({ yaw: 5000, curve: 'odd' })).toMatchObject({ yaw: 720, curve: 'balanced' });
  });
});

describe('installation by platform', () => {
  const win = (ua: string, standalone = false) => ({
    navigator: { userAgent: ua, maxTouchPoints: 5, standalone } as unknown as Navigator & { standalone?: boolean },
    matchMedia: () => ({ matches: false }) as unknown as MediaQueryList,
  });
  it('requires the Home Screen app on iPhone only, offers it on Android', () => {
    expect(installState(win('iPhone'))).toMatchObject({ gate: true, offer: false });
    expect(installState(win('iPhone', true))).toMatchObject({ gate: false, offer: false });
    expect(installState(win('Linux; Android 15'))).toMatchObject({ gate: false, offer: true });
  });
});
