// Install worker: copies the game archives into the origin-private file system in bounded pieces, from files the
// player selected, from the paired LAN PC, or out of the 2001 disc image's installer cabinet. Writes use synchronous
// access handles (available in workers in Chrome, Safari and Firefox); memory use stays at a few MB whatever the
// archive size. Each archive is read back and hashed after writing; only then is it recorded as done. The install is
// committed by the main thread writing install.json (see install-format.ts).

/// <reference lib="webworker" />
import { extractCabFile, readCabHeader, CabError } from '../files/iscab';
import { extractInnoTarget, InnoError, readInno } from '../files/gog-inno';
import { readIso, IsoError } from '../files/iso9660';
import { Md5 } from '../files/md5';
import { blobSource, type ByteSource } from '../files/pak';
import {
  FORMAT, INSTALL_DIR, MANIFEST, PROGRESS, type FromWorker, type InstallProgressFile, type InstalledFile, type InstallManifest, type InstallSource,
  type ToWorker, type WantedFile,
} from './install-format';

interface SyncHandle {
  write(data: Uint8Array, opts: { at: number }): number;
  read(data: Uint8Array, opts: { at: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

const PIECE = 4 << 20;
let abort: AbortController | null = null;
const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

class Failure extends Error {
  constructor(readonly code: Extract<FromWorker, { op: 'error' }>['code'], message: string) { super(message); }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.op === 'cancel') { abort?.abort(); return; }
  abort = new AbortController();
  const run = m.op === 'install' ? install(m.source, m.files, abort.signal)
    : m.op === 'commit' ? commit(m.manifest) : verifyAll(abort.signal);
  run.catch((err: unknown) => {
    const f = err instanceof Failure ? err
      : (err as Error)?.name === 'AbortError' ? new Failure('cancelled', 'Cancelled.')
        : (err as Error)?.name === 'QuotaExceededError' ? new Failure('quota', 'This device has no more storage for this site.')
          : err instanceof CabError || err instanceof IsoError || err instanceof InnoError ? new Failure('source', (err as Error).message)
            : new Failure('storage', String((err as Error)?.message ?? err));
    post({ op: 'error', code: f.code, message: f.message });
  });
};

async function dir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(INSTALL_DIR, { create: true });
}

async function readJson<T>(d: FileSystemDirectoryHandle, name: string): Promise<T | null> {
  try { return JSON.parse(await (await (await d.getFileHandle(name)).getFile()).text()) as T; } catch { return null; }
}

async function writeJson(d: FileSystemDirectoryHandle, name: string, value: unknown) {
  const h = await openSync(d, name);
  try {
    const data = new TextEncoder().encode(JSON.stringify(value));
    h.truncate(0);
    h.write(data, { at: 0 });
    h.flush();
  } finally { h.close(); }
}

async function openSync(d: FileSystemDirectoryHandle, name: string, create = true): Promise<SyncHandle> {
  const fh = await d.getFileHandle(name, { create });
  const open = (fh as unknown as { createSyncAccessHandle?: () => Promise<SyncHandle> }).createSyncAccessHandle;
  if (!open) throw new Failure('unsupported', 'This browser cannot write files to its private storage (no synchronous access handles).');
  return open.call(fh);
}

async function install(source: InstallSource, files: WantedFile[], signal: AbortSignal) {
  const d = await dir();
  // a new install (or a resumed one) is never playable until the main thread commits it
  await d.removeEntry(MANIFEST).catch(() => {});
  let progress = await readJson<InstallProgressFile>(d, PROGRESS);
  if (!progress || progress.format !== FORMAT || progress.source !== source.kind) progress = { format: FORMAT, source: source.kind, done: [] };
  const total = files.reduce((n, f) => n + f.size, 0);
  let before = 0;
  const report = (phase: 'copy' | 'verify', file: string, at: number) => post({ op: 'progress', phase, file, done: before + at, total });

  // the disc image is opened once: its directory and the installer header are small
  let disc: { cab: ByteSource; set: ReturnType<typeof readCabHeader> } | null = null;
  if (source.kind === 'disc-image') {
    const iso = await readIso(blobSource(source.file));
    const hdr = iso.find('Setup/data1.hdr');
    const cab = iso.find('Setup/data1.cab');
    if (!hdr || !cab) throw new Failure('source', 'This disc image has no InstallShield set (Setup/data1.hdr and data1.cab).');
    disc = { cab: iso.open(cab), set: readCabHeader(await iso.open(hdr).read(0, hdr.size), cab.size) };
  }
  // the GOG installer: its header is read once (a few hundred KB after decompression)
  const gog = source.kind === 'gog-installer' ? { src: blobSource(source.file), set: await readInno(blobSource(source.file)) } : null;

  for (const f of files) {
    signal.throwIfAborted();
    const prev = progress.done.find((x) => x.name === f.name && x.size === f.size);
    if (prev) {
      // already verified in an earlier run, and still there with its size
      const ok = await d.getFileHandle(f.name).then((h) => h.getFile()).then((x) => x.size === f.size).catch(() => false);
      if (ok) { before += f.size; report('copy', f.name, 0); continue; }
      progress.done = progress.done.filter((x) => x !== prev);
    }
    const h = await openSync(d, f.name);
    let md5: string;
    try {
      if (source.kind === 'disc-image') {
        const cf = disc!.set.files.find((x) => x.path.toLowerCase() === source.paths[f.name]?.toLowerCase());
        if (!cf) throw new Failure('source', `The disc image's installer has no ${source.paths[f.name] ?? f.name}.`);
        if (cf.expandedSize !== f.size) throw new Failure('source', `${f.name} in the disc image has an unexpected size.`);
        // compressed data can only be expanded from its start: a partial file is rewritten
        h.truncate(0);
        let at = 0;
        await extractCabFile(disc!.cab, cf, (data) => {
          signal.throwIfAborted();
          writeAll(h, data, at);
          at += data.length;
          if ((at & 0xfffff) < data.length) report('copy', f.name, at);
        }, { signal });
        h.flush();
      } else if (source.kind === 'gog-installer') {
        const t = gog!.set.targets.get(source.paths[f.name]?.toLowerCase() ?? '');
        if (!t) throw new Failure('source', `The installer has no ${source.paths[f.name] ?? f.name}.`);
        if (t.size !== f.size) throw new Failure('source', `${f.name} in the installer has an unexpected size.`);
        // pieces are unpacked from the first one: a partial file is rewritten
        h.truncate(0);
        let at = 0;
        await extractInnoTarget(gog!.src, t, (data) => {
          writeAll(h, data, at);
          at += data.length;
          report('copy', f.name, at);
        }, signal);
        h.flush();
      } else {
        // resumable: continue after what is already stored
        let at = Math.min(h.getSize(), f.size);
        if (h.getSize() > f.size) h.truncate(f.size);
        const src = source.kind === 'files' ? blobSource(source.files[f.name]) : httpRangeSource(source.urls[f.name], f.size, signal);
        if (!src || src.size !== f.size) throw new Failure('source', `${f.name} changed or is not available from the source.`);
        while (at < f.size) {
          signal.throwIfAborted();
          const n = Math.min(PIECE, f.size - at);
          const data = await src.read(at, n);
          if (data.length !== n) throw new Failure('source', `${f.name}: short read from the source.`);
          writeAll(h, data, at);
          at += n;
          report('copy', f.name, at);
        }
        h.flush();
      }
      md5 = readBack(h, f.size, signal, (at) => report('verify', f.name, at));
    } finally { h.close(); }
    if (source.kind === 'disc-image') {
      const cf = disc!.set.files.find((x) => x.path.toLowerCase() === source.paths[f.name].toLowerCase())!;
      if (cf.md5 !== md5) throw new Failure('storage', `${f.name} was not stored correctly (read-back checksum differs).`);
    }
    if (source.kind === 'gog-installer' && gog!.set.targets.get(source.paths[f.name].toLowerCase())?.md5 !== md5) {
      throw new Failure('storage', `${f.name} was not stored correctly (read-back checksum differs).`);
    }
    progress.done.push({ name: f.name, size: f.size, md5 });
    await writeJson(d, PROGRESS, progress);
    before += f.size;
  }
  post({ op: 'installed', files: files.map((f) => progress!.done.find((x) => x.name === f.name)!) });
}

function writeAll(h: SyncHandle, data: Uint8Array, at: number) {
  for (let done = 0; done < data.length;) {
    const n = h.write(data.subarray(done), { at: at + done });
    if (n <= 0) throw new Failure('storage', 'Writing to the device storage failed.');
    done += n;
  }
}

/** MD5 of the stored file, read back in pieces (what the engine will read). */
function readBack(h: SyncHandle, size: number, signal: AbortSignal, onAt: (at: number) => void): string {
  if (h.getSize() !== size) throw new Failure('storage', 'A stored file has the wrong size after writing.');
  const md5 = new Md5();
  const buf = new Uint8Array(PIECE);
  for (let at = 0; at < size;) {
    signal.throwIfAborted();
    const n = h.read(buf.subarray(0, Math.min(PIECE, size - at)), { at });
    if (n <= 0) throw new Failure('storage', 'Reading back a stored file failed.');
    md5.update(buf.subarray(0, n));
    at += n;
    onAt(at);
  }
  return md5.hex();
}

/** Same-origin byte ranges from the paired PC (its pairing cookie goes along). */
function httpRangeSource(url: string | undefined, size: number, signal: AbortSignal): ByteSource | null {
  if (!url) return null;
  return {
    size,
    async read(offset, length) {
      let res: Response;
      try {
        res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal, cache: 'no-store', credentials: 'same-origin' });
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        throw new Failure('source', 'The PC stopped answering (network or LAN host). Press Resume when it is back.');
      }
      if (res.status === 403) throw new Failure('source', 'The PC refused the download: pair this device again.');
      if (res.status !== 206) throw new Failure('source', `The PC did not return the requested part (HTTP ${res.status}).`);
      const data = new Uint8Array(await res.arrayBuffer());
      if (data.length !== length) throw new Failure('source', 'The PC returned a short part.');
      return data;
    },
  };
}

/** Makes a verified installation playable: install.json is written last, then the resume record goes. */
async function commit(manifest: InstallManifest) {
  const d = await dir();
  const progress = await readJson<InstallProgressFile>(d, PROGRESS);
  for (const f of manifest.files) {
    const done = progress?.done.find((x) => x.name === f.name);
    if (!done || done.size !== f.size || done.md5 !== f.md5) throw new Failure('storage', `${f.name} was not installed completely.`);
  }
  await writeJson(d, MANIFEST, manifest);
  await d.removeEntry(PROGRESS).catch(() => {});
  post({ op: 'committed' });
}

/** Reads every installed archive back and compares it with install.json. */
async function verifyAll(signal: AbortSignal) {
  const d = await dir();
  const m = await readJson<{ files: InstalledFile[] }>(d, MANIFEST);
  if (!m?.files) { post({ op: 'verified', ok: false, problems: ['No completed installation.'] }); return; }
  const problems: string[] = [];
  const total = m.files.reduce((n, f) => n + f.size, 0);
  let before = 0;
  for (const f of m.files) {
    let h: SyncHandle;
    try { h = await openSync(d, f.name, false); } catch { problems.push(`${f.name} is missing.`); continue; }
    try {
      if (h.getSize() !== f.size) problems.push(`${f.name} has the wrong size.`);
      else if (readBack(h, f.size, signal, (at) => post({ op: 'progress', phase: 'verify', file: f.name, done: before + at, total })) !== f.md5) problems.push(`${f.name} is damaged.`);
    } catch (err) {
      if (err instanceof Failure) problems.push(`${f.name}: ${err.message}`);
      else throw err;
    } finally { h.close(); }
    before += f.size;
  }
  post({ op: 'verified', ok: problems.length === 0, problems });
}
