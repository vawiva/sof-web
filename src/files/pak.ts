// Quake II PACK archive directory reader. Reads only the 12-byte header and the directory, never
// the entry contents, and treats every value as untrusted.

export interface PakEntry {
  name: string;
  offset: number;
  size: number;
}

export interface PakDirectory {
  entries: PakEntry[];
  directoryOffset: number;
  directoryLength: number;
}

export class PakError extends Error {}

/** Minimal random-access source: a File/Blob in the browser, a Buffer in tests. */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    async read(offset, length) {
      return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
    },
  };
}

/** A file served over HTTP with byte ranges (game data hosted by the player's own PC on the LAN). */
export function httpSource(url: string, size: number, signal?: AbortSignal): ByteSource {
  return {
    size,
    async read(offset, length) {
      if (length <= 0) return new Uint8Array(0);
      const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal, cache: 'no-store' });
      if (res.status !== 206) throw new PakError(`the server did not return the requested byte range (HTTP ${res.status})`);
      const data = new Uint8Array(await res.arrayBuffer());
      if (data.length !== length) throw new PakError('the server returned a short byte range');
      return data;
    },
  };
}

const ENTRY_SIZE = 64;
const NAME_SIZE = 56;
const MAX_ENTRIES = 65536;

export async function readPakDirectory(src: ByteSource): Promise<PakDirectory> {
  if (src.size < 12) {
    throw new PakError('file is too small to be a PACK archive');
  }
  const head = new DataView((await src.read(0, 12)).buffer);
  if (head.getUint32(0, false) !== 0x5041434b) { // "PACK"
    throw new PakError('not a PACK archive (wrong signature)');
  }
  const directoryOffset = head.getInt32(4, true);
  const directoryLength = head.getInt32(8, true);
  if (directoryLength < 0 || directoryLength % ENTRY_SIZE !== 0) {
    throw new PakError('corrupt PACK directory length');
  }
  if (directoryLength / ENTRY_SIZE > MAX_ENTRIES) {
    throw new PakError('PACK directory has too many entries');
  }
  if (directoryOffset < 12 || directoryOffset + directoryLength > src.size) {
    throw new PakError('PACK directory lies outside the file (truncated or corrupt)');
  }
  const dir = await src.read(directoryOffset, directoryLength);
  const view = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries: PakEntry[] = [];
  for (let at = 0; at < directoryLength; at += ENTRY_SIZE) {
    let end = at;
    while (end < at + NAME_SIZE && dir[end] !== 0) end++;
    const name = latin1(dir.subarray(at, end));
    const offset = view.getInt32(at + NAME_SIZE, true);
    const size = view.getInt32(at + NAME_SIZE + 4, true);
    if (!name || offset < 12 || size < 0 || offset + size > src.size) {
      throw new PakError(`PACK entry ${entries.length} is out of bounds`);
    }
    entries.push({ name, offset, size });
  }
  return { entries, directoryOffset, directoryLength };
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}
