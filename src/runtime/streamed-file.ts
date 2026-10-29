// Game archives read on demand instead of being copied into memory first.
//
// The engine reads files synchronously (fread from its virtual filesystem), so its reads must be answered
// synchronously. A synchronous XMLHttpRequest with a byte range does that on the page's main thread for
// both kinds of source the port uses: a blob: URL of a file the player selected (nothing leaves the
// device) and an HTTP URL of the restricted game-data service on the player's own PC. Binary data comes
// back through responseText with the x-user-defined charset (main-thread synchronous requests may not ask
// for an ArrayBuffer). Blocks are kept in one least-recently-used cache with a fixed byte budget.

export interface StreamStats {
  requests: number;
  bytesFetched: number;
  hits: number;
  cachedBytes: number;
  budget: number;
}

export class BlockCache {
  private blocks = new Map<string, Uint8Array>();
  private used = 0;
  readonly stats: StreamStats;

  constructor(readonly budget: number, readonly blockSize: number) {
    this.stats = { requests: 0, bytesFetched: 0, hits: 0, cachedBytes: 0, budget };
  }

  /** Block `index` of the file at `url` (`size` bytes long). */
  get(url: string, index: number, size: number): Uint8Array {
    const key = `${index}|${url}`;
    const hit = this.blocks.get(key);
    if (hit) {
      this.blocks.delete(key); // re-insert: Map order is the recency order
      this.blocks.set(key, hit);
      this.stats.hits++;
      return hit;
    }
    const from = index * this.blockSize;
    const to = Math.min(size, from + this.blockSize) - 1;
    const data = syncRange(url, from, to);
    this.stats.requests++;
    this.stats.bytesFetched += data.length;
    this.blocks.set(key, data);
    this.used += data.length;
    for (const [k, v] of this.blocks) {
      if (this.used <= this.budget) break;
      this.blocks.delete(k);
      this.used -= v.length;
    }
    this.stats.cachedBytes = this.used;
    return data;
  }
}

/** Bytes from..to (inclusive) of `url`, read synchronously. Throws when the range cannot be read exactly. */
export function syncRange(url: string, from: number, to: number): Uint8Array {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.setRequestHeader('Range', `bytes=${from}-${to}`);
  xhr.overrideMimeType('text/plain; charset=x-user-defined');
  xhr.send(null);
  if (xhr.status !== 206) throw new Error(`range ${from}-${to} of ${url} not served (HTTP ${xhr.status})`);
  const text = xhr.responseText;
  const length = to - from + 1;
  if (text.length !== length) throw new Error(`range ${from}-${to} of ${url}: ${text.length} of ${length} bytes`);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Whether synchronous ranged reads work for this URL in this browser (checked before relying on them). */
export function canStream(url: string): boolean {
  try {
    const head = syncRange(url, 0, 3);
    return String.fromCharCode(...head) === 'PACK';
  } catch {
    return false;
  }
}

interface FSNode {
  stream_ops: Record<string, unknown>;
  usedBytes?: number;
}

interface FSWithFiles {
  createFile(parent: string, name: string, properties: object, canRead: boolean, canWrite: boolean): FSNode;
  ErrnoError: new (errno: number) => Error;
}

const EIO = 29; // Emscripten's errno for I/O errors
const ENODEV = 43;

/** A read-only file in the engine's filesystem whose reads are served from the cache. */
export function createStreamedFile(FS: FSWithFiles, parent: string, name: string, url: string, size: number,
  cache: BlockCache, onError: (err: unknown) => void) {
  const node = FS.createFile(parent, name, {}, true, false);
  Object.defineProperty(node, 'usedBytes', { get: () => size });
  node.stream_ops = {
    ...node.stream_ops,
    read(_stream: unknown, buffer: Int8Array, offset: number, length: number, position: number) {
      if (position >= size) return 0;
      const n = Math.min(length, size - position);
      try {
        for (let done = 0; done < n;) {
          const at = position + done;
          const index = Math.floor(at / cache.blockSize);
          const block = cache.get(url, index, size);
          const inBlock = at - index * cache.blockSize;
          const k = Math.min(block.length - inBlock, n - done);
          buffer.set(block.subarray(inBlock, inBlock + k) as unknown as Int8Array, offset + done);
          done += k;
        }
      } catch (err) {
        onError(err);
        throw new FS.ErrnoError(EIO);
      }
      return n;
    },
    write() {
      throw new FS.ErrnoError(EIO);
    },
    mmap() {
      throw new FS.ErrnoError(ENODEV);
    },
  };
}
