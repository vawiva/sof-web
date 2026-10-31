import { describe, expect, it } from 'vitest';
import { InputTrace, redact } from '../src/app/diagnostics';
import { detectPlatform, isStandalone } from '../src/app/install';

describe('install gate', () => {
  it('requires the installed app on phones and tablets only', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Safari', 5)).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 5)).toBe('ios'); // iPadOS
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 0)).toBe('desktop');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 15) Chrome', 5)).toBe('android');
  });
  it('counts the Home Screen app as installed, browser fullscreen not', () => {
    expect(isStandalone({ standalone: true }, () => false)).toBe(true);
    expect(isStandalone({}, (q) => q === '(display-mode: standalone)')).toBe(true);
    expect(isStandalone({}, (q) => q === '(display-mode: fullscreen)')).toBe(false);
  });
});

describe('input diagnostics', () => {
  it('removes access keys from reports', () => {
    expect(redact('https://10.0.0.2:8443/?key=abcDEF123_- and sof_key=xyz; x'))
      .toBe('https://10.0.0.2:8443/?key=[redacted] and sof_key=[redacted]; x');
  });
  const s = { inGame: true, state: 'play', raw: true, handed: true, axes: [0, -1, 0, 0], buttons: 1, engineOpen: true, engineAxes: [0, 0, 0, 0], engineKeys: 0 };
  it('names the stage where controller input stops', () => {
    const t = new InputTrace();
    t.add(s);
    expect(t.verdict()).toBe('sticks during play: 0/1 samples reached the game; buttons during play: 0/1 samples reached the game');
    const u = new InputTrace();
    u.add({ ...s, engineOpen: false });
    expect(u.verdict()).toBe('the game never opened the controller');
    const r = new InputTrace();
    r.add({ ...s, raw: false, handed: false, engineOpen: false });
    expect(r.verdict()).toMatch(/^the browser never reported a controller/);
    const m = new InputTrace();
    m.add({ ...s, inGame: false, state: 'menu' });
    expect(m.verdict()).toBe('controller input arrived only while a menu, the pause or a cinematic was up, not during play');
    expect(new InputTrace().verdict()).toBe('no game session recorded yet');
  });
  it('reports input that reaches the game', () => {
    const t = new InputTrace();
    t.add({ ...s, engineAxes: [0, -1, 0, 0], engineKeys: 1 });
    expect(t.verdict()).toBe('sticks during play: 1/1 samples reached the game; buttons during play: 1/1 samples reached the game');
  });
});
