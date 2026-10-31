import { describe, expect, it } from 'vitest';
import { fitBox, frameCap, parseDisplay, pictureAspect, refreshFromIntervals } from '../src/games/sof/display';

describe('display settings', () => {
  it('defaults to the original 4:3 picture and a 60 fps target', () => {
    expect(parseDisplay(null)).toEqual({ aspect: '4:3', fps: '60' });
    expect(parseDisplay({ aspect: 'bogus', fps: 999 })).toEqual({ aspect: '4:3', fps: '60' });
    expect(parseDisplay({ aspect: 'fill', fps: 'display' })).toEqual({ aspect: 'fill', fps: 'display' });
  });

  it('chooses the picture shape', () => {
    expect(pictureAspect('4:3', 2400, 1080)).toBeCloseTo(4 / 3);
    expect(pictureAspect('16:9', 1024, 768)).toBeCloseTo(16 / 9);
    expect(pictureAspect('fill', 2400, 1080)).toBeCloseTo(2400 / 1080);
    expect(pictureAspect('fill', 3200, 1000)).toBe(2.4); // ultra-wide: bars beyond 2.4:1
    expect(pictureAspect('fill', 768, 1024)).toBeCloseTo(4 / 3); // portrait: never narrower than the original
  });

  it('fits the picture without stretching', () => {
    expect(fitBox(4 / 3, 1920, 1080)).toEqual({ width: 1440, height: 1080 });
    expect(fitBox(16 / 9, 1024, 768)).toEqual({ width: 1024, height: 576 });
  });

  it('caps frames only where the display is faster than the target', () => {
    expect(frameCap('60', 144)).toBe(60);
    expect(frameCap('60', 60)).toBe(0);
    expect(frameCap('60', 0)).toBe(60);
    expect(frameCap('30', 60)).toBe(30);
    expect(frameCap('display', 144)).toBe(0);
  });

  it('recognises refresh rates from animation-frame intervals', () => {
    expect(refreshFromIntervals(Array(30).fill(16.7))).toBe(60);
    expect(refreshFromIntervals([...Array(30).fill(6.94), 40, 1])).toBe(144);
    expect(refreshFromIntervals([16, 17])).toBe(0);
  });
});
