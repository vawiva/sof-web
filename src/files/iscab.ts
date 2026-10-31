// Read-only reader for InstallShield 5 cabinets (data1.hdr + data1.cab, as on the 2001 Soldier of Fortune Platinum
// disc). Nothing of the installer runs: the header's file table is parsed and each wanted file's compressed data is
// inflated piece by piece. Format facts follow the public documentation of the open-source "unshield" project (file
// table layout, chunked raw-deflate data); this is an independent implementation. Only single-volume, unobfuscated
// sets of major version 5 are accepted; anything else is reported precisely instead of guessed.

import { inflateRaw, InflateError } from './inflate';
import { Md5 } from './md5';
import type { ByteSource } from './pak';

export class CabError extends Error {}

export interface CabFile {
  /** '/'-separated path inside the set: the header's directory name plus the file name */
  path: string;
  expandedSize: number;
  compressedSize: number;
  dataOffset: number;
  flags: number;
  /** hex MD5 of the expanded data as recorded by the cabinet */
  md5: string;
}

export interface CabSet {
  version: number;
  files: CabFile[];
}

const FLAG_SPLIT = 1;
const FLAG_OBFUSCATED = 2;
const FLAG_COMPRESSED = 4;
const FLAG_INVALID = 8;
const MAX_FILES = 50000;

/** Reads the file table of `data1.hdr`; `cabSize` is the size of the matching data1.cab, for bounds checks. */
export function readCabHeader(hdr: Uint8Array, cabSize: number): CabSet {
  const v = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
  const need = (at: number, n: number, what: string) => { if (at < 0 || at + n > hdr.length) throw new CabError(`installer header is truncated (${what})`); };
  need(0, 20, 'common header');
  if (v.getUint32(0, true) !== 0x28635349) throw new CabError('not an InstallShield cabinet header (signature)');
  const raw = v.getUint32(4, true);
  const version = raw >>> 24 === 1 ? (raw >>> 12) & 0xf : raw >>> 24 === 2 || raw >>> 24 === 4 ? (raw & 0xffff) / 100 | 0 : 0;
  if (version !== 5) throw new CabError(`InstallShield cabinet version ${version || '0x' + raw.toString(16)} is not supported (only version 5)`);
  const descOff = v.getUint32(12, true);
  need(descOff, 0x30, 'cabinet descriptor');
  const tableOff = descOff + v.getUint32(descOff + 0x0c, true);
  const dirCount = v.getUint32(descOff + 0x1c, true);
  const fileCount = v.getUint32(descOff + 0x28, true);
  if (dirCount + fileCount > MAX_FILES) throw new CabError('installer header lists too many files');
  need(tableOff, 4 * (dirCount + fileCount), 'file table');
  const str = (at: number) => {
    need(at, 1, 'name');
    let s = '';
    for (let i = at; i < hdr.length && hdr[i] !== 0; i++) { s += String.fromCharCode(hdr[i]); if (s.length > 260) throw new CabError('name too long'); }
    return s;
  };
  const dirs: string[] = [];
  for (let i = 0; i < dirCount; i++) dirs.push(str(tableOff + v.getUint32(tableOff + 4 * i, true)));
  const files: CabFile[] = [];
  for (let i = 0; i < fileCount; i++) {
    const at = tableOff + v.getUint32(tableOff + 4 * (dirCount + i), true);
    need(at, 0x3a, 'file descriptor');
    const name = str(tableOff + v.getUint32(at, true));
    const dir = v.getUint32(at + 4, true);
    const flags = v.getUint16(at + 8, true);
    const expandedSize = v.getUint32(at + 10, true);
    const compressedSize = v.getUint32(at + 14, true);
    const dataOffset = v.getUint32(at + 0x26, true);
    let md5 = '';
    for (let k = 0; k < 16; k++) md5 += hdr[at + 0x2a + k].toString(16).padStart(2, '0');
    if (flags & FLAG_INVALID) continue;
    if (!name || dir >= dirs.length) throw new CabError(`file ${i} of the installer header is malformed`);
    const parts = [...dirs[dir].split(/[\\/]/), name].filter((p) => p !== '' && p !== '.');
    if (parts.some((p) => p === '..' || /^[a-zA-Z]:$/.test(p) || /[\x00-\x1f]/.test(p))) throw new CabError(`unsafe path in the installer header: ${parts.join('/')}`);
    if (dataOffset + compressedSize > cabSize) throw new CabError(`"${parts.join('/')}" lies outside data1.cab (truncated or a multi-disc set)`);
    files.push({ path: parts.join('/'), expandedSize, compressedSize, dataOffset, flags, md5 });
  }
  return { version, files };
}

export interface ExtractOptions {
  signal?: AbortSignal;
  /** bytes read from the cabinet per request (default 1 MB) */
  readBytes?: number;
}

/**
 * Inflates one file and passes its data to `sink` in pieces (each at most one cabinet chunk, about 32-64 KB). The
 * size and the recorded MD5 are checked at the end; a mismatch throws, so a caller writing to storage must treat the
 * output as incomplete until this resolves.
 */
export async function extractCabFile(cab: ByteSource, f: CabFile, sink: (data: Uint8Array) => Promise<void> | void,
  opts: ExtractOptions = {}): Promise<void> {
  if (f.flags & FLAG_SPLIT) throw new CabError(`"${f.path}" is split across several cabinets (multi-disc sets are not supported)`);
  if (f.flags & FLAG_OBFUSCATED) throw new CabError(`"${f.path}" is obfuscated (not supported)`);
  const md5 = new Md5();
  let out = 0;
  const emit = async (d: Uint8Array) => {
    out += d.length;
    if (out > f.expandedSize) throw new CabError(`"${f.path}" expands beyond its recorded size`);
    md5.update(d);
    await sink(d);
  };
  const reader = new WindowReader(cab, f.dataOffset, f.compressedSize, opts.readBytes ?? 1 << 20);
  if (!(f.flags & FLAG_COMPRESSED)) {
    while (reader.left > 0) { opts.signal?.throwIfAborted(); await emit(await reader.take(Math.min(reader.left, 1 << 16))); }
  } else {
    while (reader.left > 0) {
      opts.signal?.throwIfAborted();
      const head = await reader.take(2);
      const n = head[0] | (head[1] << 8);
      if (n === 0 || n > reader.left) throw new CabError(`"${f.path}": corrupt compressed chunk`);
      let data: Uint8Array;
      try { data = inflateRaw(await reader.take(n), f.expandedSize - out); }
      catch (e) { throw e instanceof InflateError ? new CabError(`"${f.path}": corrupt compressed data (${e.message})`) : e; }
      await emit(data);
    }
  }
  if (out !== f.expandedSize) throw new CabError(`"${f.path}": ${out} of ${f.expandedSize} bytes after decompression`);
  const sum = md5.hex();
  if (f.md5 !== '00000000000000000000000000000000' && sum !== f.md5) throw new CabError(`"${f.path}": checksum mismatch (damaged image?)`);
}

/** Sequential reads of a byte range in large windows. */
class WindowReader {
  private win = new Uint8Array(0);
  private at = 0;
  private pos: number;
  left: number;
  constructor(private src: ByteSource, offset: number, length: number, private chunk: number) { this.pos = offset; this.left = length; }
  async take(n: number): Promise<Uint8Array> {
    if (n > this.left) throw new CabError('read past the end of a file in data1.cab');
    if (this.win.length - this.at < n) {
      const rest = this.win.subarray(this.at);
      const want = Math.min(Math.max(this.chunk, n) - rest.length, this.left - rest.length);
      const more = await this.src.read(this.pos, want);
      this.pos += want;
      const w = new Uint8Array(rest.length + more.length);
      w.set(rest);
      w.set(more, rest.length);
      this.win = w;
      this.at = 0;
    }
    const d = this.win.subarray(this.at, this.at + n);
    this.at += n;
    this.left -= n;
    return d;
  }
}
