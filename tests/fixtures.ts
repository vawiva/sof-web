// Synthetic Quake II PACK archives for tests. They contain only made-up names and bytes.
import type { ByteSource } from '../src/files/pak';

export function makePak(entries: Array<{ name: string; data?: Uint8Array }>): Uint8Array {
  const body = entries.map((e) => e.data ?? new Uint8Array([1, 2, 3]));
  const dataLen = body.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(12 + dataLen + entries.length * 64);
  const view = new DataView(out.buffer);
  out.set([0x50, 0x41, 0x43, 0x4b], 0);
  view.setInt32(4, 12 + dataLen, true);
  view.setInt32(8, entries.length * 64, true);
  let at = 12;
  const offsets: number[] = [];
  for (const b of body) {
    offsets.push(at);
    out.set(b, at);
    at += b.length;
  }
  entries.forEach((e, i) => {
    const d = 12 + dataLen + i * 64;
    for (let c = 0; c < e.name.length; c++) out[d + c] = e.name.charCodeAt(c);
    view.setInt32(d + 56, offsets[i], true);
    view.setInt32(d + 60, body[i].length, true);
  });
  return out;
}

export function bytesSource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (o, l) => bytes.slice(o, o + l) };
}

/** A File stand-in good enough for buildGameSet (only name/size are read there). */
export function fakeFile(name: string, size = 10): File {
  return { name, size } as unknown as File;
}
