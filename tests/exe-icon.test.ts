/// <reference types="node" />
// The app icon read from an executable's resources (synthetic PE with a 2x2 4-bit icon; no game files).
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without type declarations
import { decodeDib, exeIconRGBA, fitIcon, png } from '../server/exe-icon.mjs';

/** A 2x2, 4 bpp icon bitmap: palette 0 black, 1 dark red; top row red, black; bottom row black, red. */
function dib() {
  const b = Buffer.alloc(40 + 16 * 4 + 2 * 4 + 2 * 4);
  b.writeUInt32LE(40, 0);
  b.writeInt32LE(2, 4);
  b.writeInt32LE(4, 8);
  b.writeUInt16LE(1, 12);
  b.writeUInt16LE(4, 14);
  b.writeUInt32LE(16, 32);
  b.set([0, 0, 128, 0], 40 + 4); // palette 1 = dark red (BGRA)
  const px = 40 + 64;
  b[px] = 0x01; // rows are stored bottom first: black, red
  b[px + 4] = 0x10; // top row: red, black
  return b;
}

/** Minimal PE32 with one .rsrc section holding RT_ICON 1 and RT_GROUP_ICON 1. */
function pe(icon: Buffer) {
  const group = Buffer.alloc(6 + 14);
  group.writeUInt16LE(1, 2);
  group.writeUInt16LE(1, 4);
  group[6] = 2;
  group[7] = 2;
  group.writeUInt16LE(4, 6 + 6);
  group.writeUInt32LE(icon.length, 6 + 8);
  group.writeUInt16LE(1, 6 + 12);
  const rs = Buffer.alloc(0x400);
  const RVA = 0x1000;
  const dir = (o: number, ids: Array<[number, number]>) => {
    rs.writeUInt16LE(ids.length, o + 14);
    ids.forEach(([id, to], i) => { rs.writeUInt32LE(id, o + 16 + i * 8); rs.writeUInt32LE(to >>> 0, o + 20 + i * 8); });
  };
  dir(0, [[3, 0x80000000 | 0x20], [14, 0x80000000 | 0x38]]);
  dir(0x20, [[1, 0x80000000 | 0x50]]);
  dir(0x38, [[1, 0x80000000 | 0x68]]);
  dir(0x50, [[1033, 0x80]]);
  dir(0x68, [[1033, 0x90]]);
  rs.writeUInt32LE(RVA + 0x100, 0x80);
  rs.writeUInt32LE(icon.length, 0x84);
  rs.writeUInt32LE(RVA + 0x200, 0x90);
  rs.writeUInt32LE(group.length, 0x94);
  icon.copy(rs, 0x100);
  group.copy(rs, 0x200);
  const head = Buffer.alloc(0x200);
  head.writeUInt16LE(0x5a4d, 0);
  head.writeUInt32LE(0x80, 0x3c);
  head.writeUInt32LE(0x4550, 0x80);
  head.writeUInt16LE(1, 0x86);
  head.writeUInt16LE(224, 0x94);
  head.writeUInt16LE(0x10b, 0x98);
  head.writeUInt32LE(RVA, 0x98 + 96 + 16); // data directory 2: resources
  const sec = 0x98 + 224;
  head.write('.rsrc', sec);
  head.writeUInt32LE(rs.length, sec + 8);
  head.writeUInt32LE(RVA, sec + 12);
  head.writeUInt32LE(rs.length, sec + 16);
  head.writeUInt32LE(0x200, sec + 20);
  return Buffer.concat([head, rs]);
}

describe('executable icon', () => {
  it('decodes palette bitmaps top row first', () => {
    const { w, h, rgba } = decodeDib(dib());
    expect([w, h]).toEqual([2, 2]);
    expect([...rgba.subarray(0, 4)]).toEqual([128, 0, 0, 255]);
    expect([...rgba.subarray(4, 8)]).toEqual([0, 0, 0, 255]);
  });
  it('finds the icon through the resource tree', () => {
    const icon = exeIconRGBA(pe(dib()));
    expect(icon.w).toBe(2);
    expect([...icon.rgba.subarray(12, 16)]).toEqual([128, 0, 0, 255]);
  });
  it('enlarges by whole pixels, centred on the background colour', () => {
    const out = fitIcon(decodeDib(dib()), 5);
    // 2x2 at factor 2 = 4x4 at offset (0,0) in a 5x5 square filled with the top-left colour
    const at = (x: number, y: number) => [...out.subarray((y * 5 + x) * 4, (y * 5 + x) * 4 + 4)];
    expect(at(0, 0)).toEqual([128, 0, 0, 255]);
    expect(at(2, 1)).toEqual([0, 0, 0, 255]);
    expect(at(3, 3)).toEqual([128, 0, 0, 255]);
    expect(at(4, 4)).toEqual([128, 0, 0, 255]);
  });
  it('writes a PNG', () => {
    const b = png(5, fitIcon(decodeDib(dib()), 5));
    expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  });
  it('rejects files that are not executables', () => {
    expect(() => exeIconRGBA(Buffer.alloc(200, 0x41))).toThrow();
  });
});
