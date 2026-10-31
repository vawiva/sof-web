// The game installed on this device (origin-private file system; see install-format.ts for the layout). Reading
// needs no worker: the engine streams the stored archives through blob: URLs of their File objects, exactly like
// files the player selected, so nothing is loaded into memory as a whole. Writing happens in install.worker.ts.

import {
  FORMAT, INSTALL_DIR, isManifest, MANIFEST, PROGRESS, type FromWorker, type InstallManifest, type InstallProgressFile,
  type InstallSource, type InstalledFile, type ToWorker, type WantedFile,
} from './install-format';

export type { InstallManifest, InstallSource, WantedFile };

/** Whether this browser can keep the game: the origin-private file system and workers. Synchronous access handles
 *  exist only inside workers, so the install worker itself reports their absence ('unsupported'). */
export function storageSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory && typeof Worker !== 'undefined' &&
    typeof FileSystemFileHandle !== 'undefined';
}

async function installDir(create = false): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(INSTALL_DIR, { create });
  } catch {
    return null;
  }
}

async function readJson(d: FileSystemDirectoryHandle, name: string): Promise<unknown> {
  try { return JSON.parse(await (await (await d.getFileHandle(name)).getFile()).text()); } catch { return null; }
}

export interface Installed {
  manifest: InstallManifest;
  files: Map<string, File>;
}

export type InstallState =
  | { kind: 'none' }
  | { kind: 'ready'; installed: Installed }
  /** install.json is there but an archive is missing or has the wrong size (cleared site data, storage pressure) */
  | { kind: 'damaged'; manifest: InstallManifest; problems: string[] }
  /** an interrupted install: archives verified so far and bytes stored */
  | { kind: 'partial'; source: string; doneFiles: string[]; storedBytes: number };

export async function installState(): Promise<InstallState> {
  if (!storageSupported()) return { kind: 'none' };
  const d = await installDir();
  if (!d) return { kind: 'none' };
  const m = await readJson(d, MANIFEST);
  if (isManifest(m)) {
    const files = new Map<string, File>();
    const problems: string[] = [];
    for (const f of m.files) {
      try {
        const file = await (await d.getFileHandle(f.name)).getFile();
        if (file.size !== f.size) problems.push(`${f.name} has the wrong size.`);
        else files.set(f.name, file);
      } catch {
        problems.push(`${f.name} is missing.`);
      }
    }
    return problems.length ? { kind: 'damaged', manifest: m, problems } : { kind: 'ready', installed: { manifest: m, files } };
  }
  const p = await readJson(d, PROGRESS) as InstallProgressFile | null;
  let stored = 0;
  for await (const [, h] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (h.kind === 'file') stored += (await (h as FileSystemFileHandle).getFile()).size;
  }
  if (p?.format === FORMAT || stored > 0) {
    return { kind: 'partial', source: p?.source ?? 'unknown', doneFiles: p?.done?.map((f) => f.name) ?? [], storedBytes: stored };
  }
  return { kind: 'none' };
}

export interface StorageInfo {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
}

export async function storageInfo(): Promise<StorageInfo> {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => null);
  return { usage: est?.usage ?? null, quota: est?.quota ?? null, persisted: persisted ?? null };
}

/** Asks the browser to keep this site's storage under storage pressure (granted silently or not at all). */
export async function requestPersistence(): Promise<boolean | null> {
  try { return (await navigator.storage?.persist?.()) ?? null; } catch { return null; }
}

/** Space still needed for `files`, counting what an interrupted install already stored. */
export async function spaceCheck(files: WantedFile[]): Promise<{ needed: number; available: number | null; enough: boolean }> {
  const d = await installDir();
  let have = 0;
  if (d) {
    for (const f of files) {
      try { have += Math.min(f.size, (await (await d.getFileHandle(f.name)).getFile()).size); } catch { /* not there */ }
    }
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  const needed = total - have;
  const { usage, quota } = await storageInfo();
  const available = usage !== null && quota !== null ? Math.max(0, quota - usage) : null;
  // a margin for file-system overhead and the browser's own bookkeeping
  return { needed, available, enough: available === null || available >= needed + (32 << 20) };
}

export interface InstallProgress {
  phase: 'copy' | 'verify' | 'commit';
  file: string;
  done: number;
  total: number;
}

export class InstallError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function runWorker<T>(msg: ToWorker, until: (m: FromWorker) => T | undefined, onProgress?: (p: InstallProgress) => void,
  signal?: AbortSignal): Promise<T> {
  const w = new Worker(new URL('./install.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => w.postMessage({ op: 'cancel' } satisfies ToWorker);
    signal?.addEventListener('abort', onAbort);
    const done = () => { signal?.removeEventListener('abort', onAbort); w.terminate(); };
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.op === 'progress') { onProgress?.(m); return; }
      if (m.op === 'error') { done(); reject(new InstallError(m.code, m.message)); return; }
      const r = until(m);
      if (r !== undefined) { done(); resolve(r); }
    };
    w.onerror = (e) => { done(); reject(new InstallError('storage', e.message || 'The install worker failed.')); };
    w.postMessage(msg);
  });
}

/** Copies and verifies the archives; the result must still be committed (after validation) to become playable. */
export function copyArchives(source: InstallSource, files: WantedFile[], onProgress?: (p: InstallProgress) => void,
  signal?: AbortSignal): Promise<InstalledFile[]> {
  return runWorker({ op: 'install', source, files }, (m) => (m.op === 'installed' ? m.files : undefined), onProgress, signal);
}

/** Validated File objects of the copied (not yet committed) archives, for the edition check. */
export async function stagedFiles(names: string[]): Promise<Map<string, File>> {
  const d = await installDir();
  const out = new Map<string, File>();
  if (!d) return out;
  for (const n of names) out.set(n, await (await d.getFileHandle(n)).getFile());
  return out;
}

export function commitInstall(manifest: InstallManifest): Promise<void> {
  return runWorker({ op: 'commit', manifest }, (m) => (m.op === 'committed' ? true : undefined)).then(() => {});
}

export function verifyInstall(onProgress?: (p: InstallProgress) => void, signal?: AbortSignal) {
  return runWorker({ op: 'verify' }, (m) => (m.op === 'verified' ? m : undefined), onProgress, signal);
}

/** Deletes the stored game data (archives, manifest, partial copies). Saves and settings live elsewhere and stay. */
export async function removeInstall(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(INSTALL_DIR, { recursive: true }).catch((err: Error) => {
    if (err.name !== 'NotFoundError') throw err;
  });
}

export { FORMAT as INSTALL_FORMAT };
