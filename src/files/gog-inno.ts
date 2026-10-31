// Read-only reader for the GOG installer of Soldier of Fortune (Inno Setup 5.6.2, Unicode, single file). Nothing of
// the installer runs. What is read:
//   1. the loader's offset table (signature "rDlPtS..."), which locates the setup header (setup-0) and the file data;
//   2. the two LZMA-compressed setup-0 blocks (decoded with lzma.ts): the setup headers and the data-location records;
//   3. the file records' strings. GOG stores large files as pieces under temporary names: the record of a file's first
//      piece carries before_install('<MD5 of the whole file>', '<target path>', <piece count>), and every piece record
//      after_install('<MD5 of the unpacked piece>', <packed size>, <unpacked size>). Pieces are zlib streams kept
//      uncompressed by Inno Setup. A target file is the concatenation of its unpacked pieces, in record order.
// The file records are found by their structure (ten length-prefixed UTF-16 strings, the destination in {tmp}), not
// by executing the installer's script; every piece's size and zlib checksum and every target's MD5 are verified.
// Other Inno Setup versions, encrypted or Inno-compressed data, and multi-file (.bin) installers are rejected with a
// precise message.

import { inflateRaw } from './inflate';
import { lzmaDecode } from './lzma';
import { Md5 } from './md5';
import type { ByteSource } from './pak';

export class InnoError extends Error {}

const LOADER_SIG = [0x72, 0x44, 0x6c, 0x50, 0x74, 0x53, 0xcd, 0xe6, 0xd7, 0x7b, 0x0b, 0x2a]; // "rDlPtS" + 6 bytes
const SUPPORTED = 'Inno Setup Setup Data (5.6.2) (u)';
const DATA_ENTRY = 74; // 5.6.2: slices, start, suboffset, sizes, SHA-1, timestamp, version, options
const MAX_HEADER = 32 << 20;
const MAX_PIECE = 64 << 20;

export interface InnoPiece { location: number; md5: string; packed: number; size: number; start: number; suboffset: number }
export interface InnoTarget { path: string; md5: string; size: number; pieces: InnoPiece[] }
export interface InnoSet { version: string; targets: Map<string, InnoTarget> }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(d: Uint8Array) { let c = 0xffffffff; for (const b of d) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const u32 = (d: Uint8Array, at: number) => (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0;
const u64 = (d: Uint8Array, at: number) => u32(d, at) + u32(d, at + 4) * 2 ** 32;

/** True when the file starts like a Windows program (any installer); the details are checked by readInno. */
export async function isWindowsProgram(src: ByteSource) {
  if (src.size < 64) return false;
  const h = await src.read(0, 2);
  return h[0] === 0x4d && h[1] === 0x5a;
}

async function findLoaderTable(src: ByteSource): Promise<number> {
  // the table is a resource of the loader executable, within its first few MB
  const limit = Math.min(src.size, 8 << 20);
  const win = 1 << 16;
  for (let at = 0; at < limit; at += win) {
    const d = await src.read(at, Math.min(win + 12, src.size - at));
    for (let i = 0; i + 12 <= d.length; i++) {
      if (d[i] !== 0x72) continue;
      let k = 1;
      while (k < 12 && d[i + k] === LOADER_SIG[k]) k++;
      if (k === 12) return at + i;
    }
  }
  throw new InnoError('not an Inno Setup installer (no loader table)');
}

/** One setup-0 block: a 9-byte header (CRC, stored size, compressed flag) and 4096-byte pieces each with a CRC. */
async function readBlock(src: ByteSource, at: number): Promise<{ data: Uint8Array; next: number }> {
  const h = await src.read(at, 9);
  if (crc32(h.subarray(4, 9)) !== u32(h, 0)) throw new InnoError('installer header block is damaged (CRC)');
  const stored = u32(h, 4);
  if (stored > MAX_HEADER || at + 9 + stored > src.size) throw new InnoError('installer header block lies outside the file');
  if (h[8] !== 1) throw new InnoError('uncompressed installer header blocks are not supported');
  const raw = await src.read(at + 9, stored);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < raw.length;) {
    const n = Math.min(4096, raw.length - i - 4);
    if (n <= 0) throw new InnoError('installer header block is truncated');
    const piece = raw.subarray(i + 4, i + 4 + n);
    if (crc32(piece) !== u32(raw, i)) throw new InnoError('installer header block is damaged (CRC)');
    parts.push(piece);
    i += 4 + n;
  }
  const out: Uint8Array[] = [];
  let total = 0;
  let given = 0;
  await lzmaDecode(async () => (given < parts.length ? parts[given++] : new Uint8Array(0)), (d) => {
    total += d.length;
    if (total > MAX_HEADER) throw new InnoError('installer header expands beyond the limit');
    out.push(d.slice());
  }, { maxDict: 64 << 20 });
  const data = new Uint8Array(total);
  let p = 0;
  for (const d of out) { data.set(d, p); p += d.length; }
  return { data, next: at + 9 + stored };
}

function utf16(d: Uint8Array, at: number, n: number) { let s = ''; for (let i = 0; i < n; i += 2) s += String.fromCharCode(d[at + i] | (d[at + i + 1] << 8)); return s; }

export async function readInno(src: ByteSource): Promise<InnoSet> {
  const table = await findLoaderTable(src);
  const t = await src.read(table + 12, 32);
  if (u32(t, 0) !== 1) throw new InnoError(`unsupported Inno Setup loader table version ${u32(t, 0)}`);
  const offset0 = u32(t, 20), offset1 = u32(t, 24);
  if (offset1 === 0) throw new InnoError('this installer keeps its data in separate .bin files, which are not supported here');
  if (offset0 + 64 > src.size || offset1 >= src.size) throw new InnoError('the installer is truncated (incomplete download?)');
  let version = '';
  for (const b of await src.read(offset0, 64)) { if (!b) break; version += String.fromCharCode(b); }
  if (version !== SUPPORTED) throw new InnoError(`installer format "${version || 'unknown'}" is not supported (only GOG's ${SUPPORTED})`);
  const headers = await readBlock(src, offset0 + 64);
  const locations = (await readBlock(src, headers.next)).data;
  if (locations.length % DATA_ENTRY) throw new InnoError('unexpected installer data records');
  const h = headers.data;

  // file records: ten length-prefixed strings starting with an empty source and a {tmp} destination
  const tmp = [0x7b, 0, 0x74, 0, 0x6d, 0, 0x70, 0, 0x7d, 0];
  const targets = new Map<string, InnoTarget>();
  let cur: InnoTarget | null = null;
  for (let i = 8; i + 10 <= h.length; i++) {
    if (h[i] !== 0x7b || tmp.some((b, k) => h[i + k] !== b) || u32(h, i - 8) !== 0) continue;
    let p = i - 8;
    const s: string[] = [];
    for (let k = 0; k < 10; k++) {
      if (p + 4 > h.length) break;
      const n = u32(h, p);
      if (n % 2 || n > 4096 || p + 4 + n > h.length) break;
      s.push(utf16(h, p + 4, n));
      p += 4 + n;
    }
    if (s.length < 10 || p + 24 > h.length) continue;
    const location = u32(h, p + 20);
    const before = /^before_install\('([0-9a-f]{32})', '([^']+)', (\d+)\)$/.exec(s[9]);
    const after = /^after_install\('([0-9a-f]{32})', (\d+), (\d+)\)$/.exec(s[8]);
    if (before) {
      const path = before[2].replace(/\\/g, '/');
      if (path.split('/').some((x) => x === '..' || x === '' || /^[a-zA-Z]:$/.test(x))) throw new InnoError(`unsafe path in the installer: ${path}`);
      cur = { path, md5: before[1], size: 0, pieces: [] };
      targets.set(path.toLowerCase(), cur);
      (cur as InnoTarget & { count?: number }).count = Number(before[3]);
    }
    if (after && cur) {
      if ((location + 1) * DATA_ENTRY > locations.length) throw new InnoError('installer record points outside its data records');
      const e = locations.subarray(location * DATA_ENTRY, (location + 1) * DATA_ENTRY);
      const flags = e[72] | (e[73] << 8);
      if (flags & (1 << 6)) throw new InnoError('the installer\'s data is encrypted (not supported)');
      if (flags & (1 << 7)) throw new InnoError('the installer compresses its data itself (not supported for this installer type)');
      const packed = Number(after[2]), size = Number(after[3]);
      if (u64(e, 20) !== packed || packed > MAX_PIECE || size > MAX_PIECE) throw new InnoError('installer piece sizes do not match');
      cur.pieces.push({ location, md5: after[1], packed, size, start: offset1 + u32(e, 8), suboffset: u64(e, 12) });
      cur.size += size;
    }
  }
  for (const tg of targets.values()) {
    const count = (tg as InnoTarget & { count?: number }).count;
    if (tg.pieces.length !== count) throw new InnoError(`${tg.path}: ${tg.pieces.length} of ${count} pieces found in the installer`);
    for (const pc of tg.pieces) if (pc.start + 4 + pc.suboffset + pc.packed > src.size) throw new InnoError(`${tg.path} lies outside the installer (truncated download?)`);
  }
  if (!targets.size) throw new InnoError('no GOG file pieces found in this installer');
  return { version, targets };
}

async function inflateZlib(d: Uint8Array, expect: number): Promise<Uint8Array> {
  if (d.length < 6 || (d[0] & 0x0f) !== 8 || ((d[0] << 8) | d[1]) % 31) throw new InnoError('a piece is not zlib data');
  if (typeof DecompressionStream !== 'undefined') {
    // the browser's own decoder checks the zlib checksum
    const res = new Response(new Blob([d as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate')));
    const out = new Uint8Array(await res.arrayBuffer());
    if (out.length !== expect) throw new InnoError('a piece has the wrong size after unpacking');
    return out;
  }
  return inflateRaw(d.subarray(2), expect);
}

/** Unpacks one target file piece by piece into `sink`; resolves with its MD5 after checking it against the installer. */
export async function extractInnoTarget(src: ByteSource, t: InnoTarget, sink: (d: Uint8Array) => Promise<void> | void,
  signal?: AbortSignal): Promise<string> {
  const md5 = new Md5();
  for (const p of t.pieces) {
    signal?.throwIfAborted();
    const zlb = await src.read(p.start, 4);
    if (zlb[0] !== 0x7a || zlb[1] !== 0x6c || zlb[2] !== 0x62 || zlb[3] !== 0x1a) throw new InnoError('damaged installer data (chunk signature)');
    let out: Uint8Array;
    try {
      out = await inflateZlib(await src.read(p.start + 4 + p.suboffset, p.packed), p.size);
    } catch (e) {
      throw e instanceof InnoError ? e : new InnoError(`${t.path}: damaged piece (${(e as Error).message})`);
    }
    md5.update(out);
    await sink(out);
  }
  const sum = md5.hex();
  if (sum !== t.md5) throw new InnoError(`${t.path}: checksum differs from the installer's record (damaged download?)`);
  return sum;
}
