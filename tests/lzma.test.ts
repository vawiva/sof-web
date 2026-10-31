import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lzma2Decode, lzmaDecode, LzmaError, type Pull } from '../src/files/lzma';

// fixtures: synthetic data compressed with Python's lzma module (liblzma), see the commit that added them
const fx = (n: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', n)));
const plain = fx('lzma-plain.bin');
const pieces = (d: Uint8Array, size: number): Pull => { let at = 0; return async () => { const p = d.subarray(at, at + size); at += p.length; return p; }; };
async function collect(run: (sink: (d: Uint8Array) => void) => Promise<void>) {
  const parts: Uint8Array[] = [];
  await run((d) => { parts.push(d.slice()); });
  return new Uint8Array(Buffer.concat(parts));
}

describe('lzma', () => {
  it('decodes LZMA1 with an end marker, in small and large input pieces', async () => {
    for (const size of [1, 7, 4096, 1 << 20]) {
      expect(await collect((s) => lzmaDecode(pieces(fx('lzma1.bin'), size), s))).toEqual(plain);
    }
  });
  it('decodes LZMA1 with a known size', async () => {
    expect(await collect((s) => lzmaDecode(pieces(fx('lzma1.bin'), 999), s, { size: plain.length }))).toEqual(plain);
  });
  it('decodes LZMA2', async () => {
    for (const size of [3, 65536]) expect(await collect((s) => lzma2Decode(pieces(fx('lzma2.bin'), size), s))).toEqual(plain);
  });
  it('rejects truncated and corrupt data and oversized dictionaries', async () => {
    const d = fx('lzma1.bin');
    await expect(collect((s) => lzmaDecode(pieces(d.subarray(0, d.length >> 1), 4096), s))).rejects.toThrow(LzmaError);
    const bad = d.slice(); for (let i = 200; i < 260; i++) bad[i] ^= 0x5a;
    await expect(collect((s) => lzmaDecode(pieces(bad, 4096), s, { size: plain.length }))).rejects.toThrow();
    await expect(collect((s) => lzmaDecode(pieces(d, 4096), s, { maxDict: 1024 }))).rejects.toThrow(/exceeds the limit/);
  });
});
