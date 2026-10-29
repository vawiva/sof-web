import { describe, expect, it } from 'vitest';
import { bestMode, presentationArgs, savedMode, SOF_MODES } from '../src/games/sof/presentation';

const setOf = (args: string[]) => {
  const m = new Map<string, string>();
  for (let i = 0; i + 2 < args.length + 1; i++) if (args[i] === '+set') m.set(args[i + 1], args[i + 2]);
  return m;
};

describe('original video modes', () => {
  it('maps gl_mode to the 4:3 resolutions of the original video page', () => {
    expect(SOF_MODES[3]).toEqual([640, 480]);
    expect(SOF_MODES[9]).toEqual([1600, 1200]);
    for (const [w, h] of SOF_MODES) expect(w * 3).toBe(h * 4);
  });

  it('picks the largest original mode that fits the box, never below 640x480', () => {
    expect(bestMode(1067, 800)).toBe(6); // 1024x768
    expect(bestMode(1440, 1080)).toBe(8); // 1280x960
    expect(bestMode(2560, 1920)).toBe(9); // the page offers nothing above 1600x1200
    expect(bestMode(520, 390)).toBe(3);
  });

  it('reads the saved mode from config.cfg', () => {
    expect(savedMode('set gl_mode "6"\nset vid_gamma "0"')).toBe(6);
    expect(savedMode('set gl_mode "-2"')).toBe(-2);
    expect(savedMode('set gl_modulate "1"')).toBeNull();
    expect(savedMode(null)).toBeNull();
  });
});

describe('engine arguments', () => {
  const base = { box: { width: 1067, height: 800 }, console: false, touch: false };

  it('switches openMERC layout options back to the original composition', () => {
    const s = setOf(presentationArgs({ ...base, configText: null }));
    expect(s.get('menu_layout')).toBe('0');
    expect(s.get('menu_rail')).toBe('0');
    expect(s.get('menu_dialogdim')).toBe('0');
    expect(s.get('vid_fullscreen')).toBe('0');
    expect(s.get('console')).toBe('0');
    expect(s.get('om_autosave_interval')).toBe('0');
    expect(s.has('in_grab')).toBe(false);
  });

  it('sets a mode on the first start and for modes of older builds, keeps the player\'s choice otherwise', () => {
    expect(setOf(presentationArgs({ ...base, configText: null })).get('gl_mode')).toBe('6');
    expect(setOf(presentationArgs({ ...base, configText: 'set gl_mode "-2"' })).get('gl_mode')).toBe('6');
    expect(setOf(presentationArgs({ ...base, configText: 'set gl_mode "3"' })).has('gl_mode')).toBe(false);
  });

  it('never lets a touch session capture the mouse and honours the console option', () => {
    const s = setOf(presentationArgs({ ...base, configText: null, touch: true, console: true }));
    expect(s.get('in_grab')).toBe('0');
    expect(s.get('console')).toBe('1');
  });
});
