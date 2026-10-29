// Ways to obtain the player's files: file input (files or a folder), drag and drop, and - where the
// browser supports it - a folder handle that can be remembered for the next visit.

import type { SelectedFile } from './gameset';

export function fromFileList(list: FileList | File[]): SelectedFile[] {
  return [...list].map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file }));
}

export async function fromDataTransfer(dt: DataTransfer): Promise<SelectedFile[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return fromFileList(dt.files);
  const out: SelectedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string, depth: number): Promise<void> => {
    if (depth > 8) return; // a game install is shallow; do not wander through huge trees
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ path: prefix + entry.name, file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`, depth + 1);
      }
    }
  };
  for (const e of entries) await walk(e, '', 0);
  return out;
}

// ---- File System Access API (Chromium): remember the chosen folder --------------------------------

export type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>;
  values(): AsyncIterable<FileSystemHandle>;
};

export const canPickFolderHandle = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

export async function pickFolderHandle(): Promise<DirHandle> {
  return (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ id: 'sof-game', mode: 'read' });
}

export async function filesFromHandle(dir: DirHandle): Promise<SelectedFile[]> {
  const out: SelectedFile[] = [];
  const walk = async (d: DirHandle, prefix: string, depth: number): Promise<void> => {
    if (depth > 2) return; // the install root or base/ is enough
    for await (const h of d.values()) {
      if (h.kind === 'file') out.push({ path: prefix + h.name, file: await (h as FileSystemFileHandle).getFile() });
      else if (h.kind === 'directory' && h.name.toLowerCase() === 'base') await walk(h as DirHandle, `${prefix}${h.name}/`, depth + 1);
    }
  };
  await walk(dir, `${dir.name}/`, 0);
  return out;
}

const HANDLE_DB = 'sof-browser-port';

function handleStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result.transaction('handles', mode).objectStore('handles'));
    req.onerror = () => reject(req.error);
  });
}

export async function rememberHandle(h: DirHandle | null): Promise<void> {
  const store = await handleStore('readwrite');
  await new Promise((res, rej) => {
    const r = h ? store.put(h, 'game') : store.delete('game');
    r.onsuccess = res;
    r.onerror = () => rej(r.error);
  });
}

export async function rememberedHandle(): Promise<DirHandle | null> {
  try {
    const store = await handleStore('readonly');
    return await new Promise((res) => {
      const r = store.get('game');
      r.onsuccess = () => res((r.result as DirHandle) ?? null);
      r.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

/** Asks again for read access to a remembered folder; must run inside a user gesture. */
export async function reopenHandle(h: DirHandle): Promise<boolean> {
  if ((await h.queryPermission?.({ mode: 'read' })) === 'granted') return true;
  return (await h.requestPermission?.({ mode: 'read' })) === 'granted';
}
