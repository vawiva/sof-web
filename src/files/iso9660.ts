// Read-only ISO 9660 reader (data CDs such as the 2001 Platinum disc image). Reads the volume descriptors and the
// directory records it needs, never the whole image; Joliet names are used when the image has them. Every value
// is untrusted: sizes, extents and record lengths are bounds-checked, directory depth and entry counts are limited.

import type { ByteSource } from './pak';

export class IsoError extends Error {}

export interface IsoEntry {
  /** '/'-separated path from the image root, as recorded (Joliet name when present, version suffix removed) */
  path: string;
  dir: boolean;
  /** byte offset of the file in the image and its length */
  offset: number;
  size: number;
}

const SECTOR = 2048;
const MAX_ENTRIES = 20000;
const MAX_DEPTH = 16;
const MAX_DIR_BYTES = 4 << 20;

/** True when the source looks like an ISO 9660 image (primary volume descriptor at sector 16). */
export async function isIso(src: ByteSource): Promise<boolean> {
  if (src.size < 17 * SECTOR) return false;
  const d = await src.read(16 * SECTOR, 8);
  return d[0] === 1 && ascii(d.subarray(1, 6)) === 'CD001';
}

export interface IsoImage {
  volumeId: string;
  entries: IsoEntry[];
  /** the file at `path` (case-insensitive), or undefined */
  find(path: string): IsoEntry | undefined;
  /** a byte source for one file of the image */
  open(entry: IsoEntry): ByteSource;
}

export async function readIso(src: ByteSource): Promise<IsoImage> {
  if (!(await isIso(src))) throw new IsoError('not an ISO 9660 disc image (no volume descriptor at sector 16)');
  let primary: Uint8Array | null = null;
  let joliet: Uint8Array | null = null;
  for (let s = 16; s < 64; s++) {
    if ((s + 1) * SECTOR > src.size) break;
    const d = await src.read(s * SECTOR, SECTOR);
    if (ascii(d.subarray(1, 6)) !== 'CD001') throw new IsoError(`bad volume descriptor at sector ${s}`);
    if (d[0] === 255) break;
    if (d[0] === 1 && !primary) primary = d;
    // supplementary descriptor with a UCS-2 escape sequence: Joliet
    if (d[0] === 2 && d[88] === 0x25 && d[89] === 0x2f && [0x40, 0x43, 0x45].includes(d[90])) joliet = d;
  }
  if (!primary) throw new IsoError('no primary volume descriptor');
  const pvd = primary;
  const blockSize = u16(pvd, 128);
  if (blockSize !== SECTOR) throw new IsoError(`unsupported logical block size ${blockSize}`);
  const ucs2 = !!joliet;
  const root = (joliet ?? pvd).subarray(156, 156 + 34);
  const entries: IsoEntry[] = [];
  const seen = new Set<number>();

  const walk = async (extent: number, length: number, prefix: string, depth: number) => {
    if (depth > MAX_DEPTH) throw new IsoError('directory tree too deep');
    if (seen.has(extent)) throw new IsoError('directory loop');
    seen.add(extent);
    if (length > MAX_DIR_BYTES || extent * SECTOR + length > src.size) throw new IsoError('directory outside the image');
    const data = await src.read(extent * SECTOR, length);
    for (let at = 0; at < length;) {
      const len = data[at];
      if (len === 0) { at = (Math.floor(at / SECTOR) + 1) * SECTOR; continue; } // records do not cross sectors
      if (len < 34 || at + len > length) throw new IsoError('corrupt directory record');
      const rec = data.subarray(at, at + len);
      at += len;
      const nameLen = rec[32];
      if (33 + nameLen > len) throw new IsoError('corrupt directory record name');
      const raw = rec.subarray(33, 33 + nameLen);
      if (nameLen === 1 && (raw[0] === 0 || raw[0] === 1)) continue; // . and ..
      let name = ucs2 ? utf16be(raw) : ascii(raw);
      name = name.replace(/;\d+$/, '');
      if (!ucs2) name = name.replace(/\.$/, '');
      if (!name || /[/\\]/.test(name) || name === '.' || name === '..') throw new IsoError('unsafe name in the image');
      const fileExtent = u32(rec, 2);
      const size = u32(rec, 10);
      const dir = (rec[25] & 2) !== 0;
      if ((rec[25] & 0x80) !== 0) throw new IsoError(`multi-extent file "${name}" is not supported`);
      const path = prefix ? `${prefix}/${name}` : name;
      if (fileExtent * SECTOR + (dir ? 0 : size) > src.size) throw new IsoError(`"${path}" lies outside the image (truncated image?)`);
      if (entries.length >= MAX_ENTRIES) throw new IsoError('too many files in the image');
      entries.push({ path, dir, offset: fileExtent * SECTOR, size });
      if (dir) await walk(fileExtent, size, path, depth + 1);
    }
  };
  await walk(u32(root, 2), u32(root, 10), '', 0);

  const byPath = new Map(entries.map((e) => [e.path.toLowerCase(), e]));
  return {
    volumeId: ascii(pvd.subarray(40, 72)).trim(),
    entries,
    find: (p) => byPath.get(p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()),
    open: (e) => ({
      size: e.size,
      read: (offset, length) => {
        if (offset < 0 || length < 0 || offset + length > e.size) throw new IsoError(`read outside "${e.path}"`);
        return src.read(e.offset + offset, length);
      },
    }),
  };
}

function u16(d: Uint8Array, at: number) { return d[at] | (d[at + 1] << 8); }
function u32(d: Uint8Array, at: number) { return (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0; }
function ascii(d: Uint8Array) { let s = ''; for (const b of d) s += String.fromCharCode(b); return s; }
function utf16be(d: Uint8Array) { let s = ''; for (let i = 0; i + 1 < d.length; i += 2) s += String.fromCharCode((d[i] << 8) | d[i + 1]); return s; }
