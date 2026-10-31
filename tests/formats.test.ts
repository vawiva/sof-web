import { createHash } from 'node:crypto';
import { deflateRawSync, constants } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CabError, extractCabFile, readCabHeader } from '../src/files/iscab';
import { inflateRaw, InflateError } from '../src/files/inflate';
import { IsoError, readIso } from '../src/files/iso9660';
import { Md5 } from '../src/files/md5';
import type { ByteSource } from '../src/files/pak';

const mem = (d: Uint8Array): ByteSource => ({ size: d.length, read: async (o, n) => d.slice(o, o + n) });
const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => ((i * 31 + seed * 7 + (i >> 7)) * 13) & 255);

describe('md5', () => {
  it('matches node:crypto for lengths around the block boundaries and split updates', () => {
    const buf = bytes(5000);
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 5000]) {
      expect(new Md5().update(buf.subarray(0, n)).hex()).toBe(createHash('md5').update(buf.subarray(0, n)).digest('hex'));
    }
    const m = new Md5().update(buf.subarray(0, 3)).update(buf.subarray(3, 70)).update(buf.subarray(70));
    expect(m.hex()).toBe(createHash('md5').update(buf).digest('hex'));
  });
});

describe('inflateRaw', () => {
  const data = new Uint8Array([...bytes(30000), ...new Uint8Array(20000).fill(65), ...bytes(10000, 3)]);
  it('decodes a complete stream (final block)', () => {
    expect(inflateRaw(deflateRawSync(data), data.length)).toEqual(data);
  });
  it('decodes a sync-flushed chunk without a final block', () => {
    const chunk = deflateRawSync(data, { finishFlush: constants.Z_SYNC_FLUSH });
    expect(inflateRaw(chunk, data.length)).toEqual(data);
  });
  it('decodes stored blocks', () => {
    expect(inflateRaw(deflateRawSync(data, { level: 0 }), data.length)).toEqual(data);
  });
  it('rejects output beyond the limit and corrupt input', () => {
    expect(() => inflateRaw(deflateRawSync(data), 100)).toThrow(InflateError);
    expect(() => inflateRaw(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 1000)).toThrow(InflateError);
  });
});

/** A minimal ISO 9660 image: one directory "Setup" with the given files (no Joliet). */
function makeIso(files: Record<string, Uint8Array>): Uint8Array {
  const S = 2048;
  const names = Object.keys(files);
  let next = 20; // first free sector after descriptors (16, 17) and directories (18, 19)
  const extents = names.map((n) => { const e = next; next += Math.ceil(files[n].length / S) || 1; return e; });
  const img = new Uint8Array(next * S);
  const rec = (extent: number, size: number, dir: boolean, name: Uint8Array) => {
    const len = 33 + name.length + ((33 + name.length) % 2);
    const r = new Uint8Array(len);
    const v = new DataView(r.buffer);
    r[0] = len; v.setUint32(2, extent, true); v.setUint32(6, extent, false); v.setUint32(10, size, true); v.setUint32(14, size, false);
    r[25] = dir ? 2 : 0; r[32] = name.length; r.set(name, 33);
    return r;
  };
  const enc = (s: string) => new TextEncoder().encode(s);
  const pvd = img.subarray(16 * S, 17 * S);
  pvd[0] = 1; pvd.set(enc('CD001'), 1); pvd[6] = 1; pvd.set(enc('TESTVOL'.padEnd(32)), 40);
  new DataView(pvd.buffer, pvd.byteOffset).setUint16(128, S, true);
  pvd.set(rec(18, S, true, new Uint8Array([0])), 156);
  const term = img.subarray(17 * S, 18 * S); term[0] = 255; term.set(enc('CD001'), 1);
  let at = 18 * S;
  for (const r of [rec(18, S, true, new Uint8Array([0])), rec(18, S, true, new Uint8Array([1])), rec(19, S, true, enc('SETUP'))]) { img.set(r, at); at += r.length; }
  at = 19 * S;
  for (const r of [rec(19, S, true, new Uint8Array([0])), rec(18, S, true, new Uint8Array([1]))]) { img.set(r, at); at += r.length; }
  names.forEach((n, i) => { const r = rec(extents[i], files[n].length, false, enc(n.toUpperCase() + ';1')); img.set(r, at); at += r.length; img.set(files[n], extents[i] * S); });
  return img;
}

/** A minimal InstallShield 5 set: header with one directory and the given files; data in chunks of `chunk` bytes. */
function makeCab(files: Array<{ dir: string; name: string; data: Uint8Array }>, chunk = 4096, finalBlock = false) {
  const parts: Uint8Array[] = [];
  let cabSize = 512; // a volume header area that is never parsed
  const entries = files.map((f) => {
    const packed: number[] = [];
    for (let i = 0; i < f.data.length; i += chunk) {
      const c = deflateRawSync(f.data.subarray(i, i + chunk), finalBlock ? {} : { finishFlush: constants.Z_SYNC_FLUSH });
      packed.push(c.length & 255, c.length >> 8, ...c);
    }
    const p = Uint8Array.from(packed);
    const e = { ...f, offset: cabSize, packed: p.length, md5: createHash('md5').update(f.data).digest() };
    parts.push(p);
    cabSize += p.length;
    return e;
  });
  const cab = new Uint8Array(cabSize);
  let at = 512;
  for (const p of parts) { cab.set(p, at); at += p.length; }

  const dirs = [...new Set(files.map((f) => f.dir))];
  const descOff = 0x200;
  const tableRel = 0x400;
  const strings: number[] = [];
  const str = (s: string) => { const off = 4 * (dirs.length + files.length) + 0x40 * files.length + strings.length; strings.push(...new TextEncoder().encode(s), 0); return off; };
  const dirOffs = dirs.map(str);
  const nameOffs = entries.map((e) => str(e.name));
  const table = new Uint8Array(4 * (dirs.length + files.length) + 0x40 * files.length + strings.length);
  const tv = new DataView(table.buffer);
  dirOffs.forEach((o, i) => tv.setUint32(4 * i, o, true));
  entries.forEach((e, i) => {
    const fd = 4 * (dirs.length + files.length) + 0x40 * i;
    tv.setUint32(4 * (dirs.length + i), fd, true);
    tv.setUint32(fd, nameOffs[i], true);
    tv.setUint32(fd + 4, dirs.indexOf(e.dir), true);
    tv.setUint16(fd + 8, 4, true);
    tv.setUint32(fd + 10, e.data.length, true);
    tv.setUint32(fd + 14, e.packed, true);
    tv.setUint32(fd + 0x26, e.offset, true);
    table.set(e.md5, fd + 0x2a);
  });
  table.set(strings, 4 * (dirs.length + files.length) + 0x40 * files.length);
  const hdr = new Uint8Array(descOff + tableRel + table.length);
  const hv = new DataView(hdr.buffer);
  hv.setUint32(0, 0x28635349, true);
  hv.setUint32(4, 0x01005201, true);
  hv.setUint32(12, descOff, true);
  hv.setUint32(descOff + 0x0c, tableRel, true);
  hv.setUint32(descOff + 0x1c, dirs.length, true);
  hv.setUint32(descOff + 0x28, files.length, true);
  hdr.set(table, descOff + tableRel);
  return { hdr, cab };
}

describe('InstallShield 5 cabinet in an ISO image', () => {
  const pak = bytes(70000, 5);
  const dll = bytes(3000, 9);
  const { hdr, cab } = makeCab([{ dir: 'base', name: 'pak0.pak', data: pak }, { dir: 'base', name: 'gamex86.dll', data: dll }]);

  it('lists the files and extracts them with checksum checks', async () => {
    const iso = await readIso(mem(makeIso({ 'data1.hdr': hdr, 'data1.cab': cab })));
    expect(iso.volumeId).toBe('TESTVOL');
    const h = iso.find('setup/DATA1.HDR')!;
    const c = iso.find('Setup/data1.cab')!;
    const set = readCabHeader(await iso.open(h).read(0, h.size), c.size);
    expect(set.files.map((f) => f.path)).toEqual(['base/pak0.pak', 'base/gamex86.dll']);
    const out: Uint8Array[] = [];
    await extractCabFile(iso.open(c), set.files[0], (d) => { out.push(d.slice()); }, { readBytes: 5000 });
    expect(Buffer.concat(out)).toEqual(Buffer.from(pak));
  });

  it('also accepts chunks that end with a final block', async () => {
    const x = makeCab([{ dir: 'base', name: 'a.pak', data: pak }], 4096, true);
    const set = readCabHeader(x.hdr, x.cab.length);
    let n = 0;
    await extractCabFile(mem(x.cab), set.files[0], (d) => { n += d.length; });
    expect(n).toBe(pak.length);
  });

  it('rejects damaged data, other versions, unsafe paths and truncated cabinets', async () => {
    const set = readCabHeader(hdr, cab.length);
    const bad = cab.slice();
    bad[set.files[0].dataOffset + 100] ^= 0x55;
    await expect(extractCabFile(mem(bad), set.files[0], () => {})).rejects.toThrow(CabError);
    const v6 = hdr.slice(); new DataView(v6.buffer).setUint32(4, 0x01006001, true);
    expect(() => readCabHeader(v6, cab.length)).toThrow(/version 6/);
    expect(() => readCabHeader(hdr, 600)).toThrow(/outside data1.cab/);
    const evil = makeCab([{ dir: '..', name: 'x.pak', data: dll }]);
    expect(() => readCabHeader(evil.hdr, evil.cab.length)).toThrow(/unsafe path/);
  });

  it('rejects images that are not ISO 9660 or are truncated', async () => {
    await expect(readIso(mem(bytes(40000)))).rejects.toThrow(IsoError);
    const img = makeIso({ 'data1.hdr': hdr, 'data1.cab': cab });
    await expect(readIso(mem(img.subarray(0, img.length - 4096)))).rejects.toThrow(/outside the image/);
  });
});
