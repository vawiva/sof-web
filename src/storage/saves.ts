// Settings and saves live in the engine's /sof/user directory, which Emscripten's IDBFS persists in
// an IndexedDB database named after the mount point. These helpers read that database directly so
// saves can be exported, imported or deleted from the startup page without starting the engine.

const DB = '/sof/user';
const STORE = 'FILE_DATA';
const FORMAT = 'sof-browser-saves';

interface Entry { timestamp: Date; mode: number; contents?: Uint8Array }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 21); // IDBFS's DB_VERSION
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE).createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function all(db: IDBDatabase): Promise<Map<string, Entry>> {
  return new Promise((resolve, reject) => {
    const out = new Map<string, Entry>();
    const cur = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return resolve(out);
      out.set(String(c.key), c.value as Entry);
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
}

export interface ProfileSummary { files: number; bytes: number; saves: string[] }

export async function summarize(): Promise<ProfileSummary> {
  const db = await open();
  try {
    const entries = await all(db);
    let bytes = 0;
    const saves = new Set<string>();
    for (const [path, e] of entries) {
      bytes += e.contents?.byteLength ?? 0;
      const m = /\/save\/([^/]+)\.sof$/i.exec(path); // save/<name>.sof
      if (m && e.contents) saves.add(m[1]);
    }
    return { files: [...entries.values()].filter((e) => e.contents).length, bytes, saves: [...saves].sort() };
  } finally {
    db.close();
  }
}

export async function exportProfile(): Promise<Blob> {
  const db = await open();
  try {
    const files = [...(await all(db))].map(([path, e]) => ({
      path, mode: e.mode, timestamp: new Date(e.timestamp).getTime(),
      data: e.contents ? base64(e.contents) : null,
    }));
    return new Blob([JSON.stringify({ format: FORMAT, version: 1, files })], { type: 'application/json' });
  } finally {
    db.close();
  }
}

export async function importProfile(file: File): Promise<number> {
  let parsed: { format?: string; version?: number; files?: Array<{ path: string; mode: number; timestamp: number; data: string | null }> };
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('This is not a saves file exported by this page.');
  }
  if (parsed.format !== FORMAT || parsed.version !== 1 || !Array.isArray(parsed.files)) {
    throw new Error('This is not a saves file exported by this page (or it was made by a newer version).');
  }
  for (const f of parsed.files) {
    if (typeof f.path !== 'string' || !f.path.startsWith(DB) || f.path.includes('/../') ||
      typeof f.mode !== 'number' || (f.data !== null && typeof f.data !== 'string')) {
      throw new Error('The saves file is damaged; nothing was imported.');
    }
  }
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const f of parsed.files!) {
        const entry: Entry = { timestamp: new Date(f.timestamp), mode: f.mode };
        if (f.data !== null) entry.contents = unbase64(f.data);
        store.put(entry, f.path);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return parsed.files.filter((f) => f.data !== null).length;
  } finally {
    db.close();
  }
}

export function deleteProfile(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other tabs running the game, then try again.'));
  });
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unbase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
