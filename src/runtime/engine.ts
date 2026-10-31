// Boots the openMERC WebAssembly build with the player's own game files.
//
// Data path: every game archive is a URL - a blob: URL of a file the player selected on this device, or
// a URL of the restricted game-data service on the player's own PC (LAN host mode). By default the engine
// reads the archives on demand through a bounded block cache (streamed-file.ts); 'preload' copies them
// into memory first (the earlier behaviour, kept as a fallback for browsers without synchronous ranged
// reads). Nothing is uploaded. Settings and saves live in /sof/user, which is persisted in IndexedDB.
//
// openMERC's own data archive (zz_openmerc.pak: replacement menu pages, TrueType menu fonts, a modern key
// layout and video defaults) is deliberately not loaded: the game's original menus, fonts and configs come
// from the player's archives.

import { defaultGatewayUrl, GatewayTransport, type GatewayStats } from '../net/gateway';
import { BlockCache, canStream, createStreamedFile, type StreamStats } from './streamed-file';

const ENGINE_FILES: Array<[string, string]> = [
  ['ref_gles3.so', '/sof/ref_gles3.so'],
  ['OMsnd.so', '/sof/OMsnd.so'],
  ['gamex86.so', '/sof/base/gamex86.so'],
  ['player.so', '/sof/base/player.so'],
];

/** The subset of the Emscripten module object this adapter uses. */
interface EmscriptenModule {
  canvas: HTMLCanvasElement;
  noInitialRun: boolean;
  print(text: string): void;
  printErr(text: string): void;
  onQuit?: () => void;
  netSend?: (ip: Uint8Array, port: number, data: Uint8Array) => void;
  netRecv?: () => { ip: Uint8Array; port: number; data: Uint8Array } | undefined;
  onRuntimeInitialized?: () => void;
  onAbort?: (what: unknown) => void;
  callMain(args: string[]): void;
  ccall(name: string, ret: null, types: string[], args: unknown[]): void;
  ccall(name: string, ret: 'number', types: string[], args: unknown[]): number;
  ccall(name: string, ret: 'string', types: string[], args: unknown[]): string;
  FS: EmscriptenFS;
  IDBFS: unknown;
}

/** One game archive: canonical name, size and where its bytes are read from. */
export interface PakFile {
  name: string;
  size: number;
  url: string;
}

interface EmscriptenFS {
  mkdirTree(path: string): void;
  mount(type: unknown, opts: object, path: string): void;
  syncfs(populate: boolean, cb: (err: unknown) => void): void;
  createDataFile(parent: string, name: string, data: Uint8Array, read: boolean, write: boolean, own: boolean): void;
  chdir(path: string): void;
  readdir(path: string): string[];
  stat(path: string): { mode: number; size: number };
  isDir(mode: number): boolean;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array): void;
  unlink(path: string): void;
  createFile(parent: string, name: string, properties: object, canRead: boolean, canWrite: boolean): { stream_ops: Record<string, unknown> };
  ErrnoError: new (errno: number) => Error;
}

export interface Progress {
  phase: 'engine' | 'data' | 'saves' | 'starting';
  label: string;
  done: number;
  total: number;
}

export interface EngineSession {
  module: EmscriptenModule;
  /** Writes the persistent user directory (settings and saves) to IndexedDB now. */
  persist(): Promise<void>;
  /** Engine console output so far (for diagnostics and bug reports). */
  log: string[];
  /** What keyboard and mouse drive now: 'game', 'console', 'message' or 'menu', and whether a level runs. */
  inputState(): { dest: 'game' | 'console' | 'message' | 'menu'; inLevel: boolean };
  /** how the archives are read, and the block cache's counters when streamed */
  data: { mode: 'stream' | 'preload'; stats?: StreamStats };
  /** multiplayer datagrams through the page's gateway */
  net: GatewayStats;
}

export interface StartOptions {
  canvas: HTMLCanvasElement;
  paks: PakFile[];
  /** 'stream' (default): read on demand through a cache of `cacheBytes`; 'preload': copy everything first */
  dataMode?: 'stream' | 'preload';
  cacheBytes?: number;
  /** engine command-line arguments, built from the stored profile (config.cfg text, or null on first start) */
  args?: (configText: string | null) => string[];
  /** values the engine reads from its Module object (browser patches: wideAspect, frameCap) */
  moduleProps?: Record<string, unknown>;
  /** config text executed once, when the profile has no config.cfg yet */
  firstRunConfig?: string;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
  onLog?: (line: string) => void;
  onExit?: (reason: string) => void;
  /** the player quit through the game's own menu; settings and saves are stored before this is called */
  onQuit?: () => void;
}

/** Block size and default cache budget for streamed archives (measured trade-offs in docs/STATUS.md). */
const BLOCK_BYTES = 1 << 20;
const DEFAULT_CACHE_BYTES = 48 << 20; // measured: 96 MB -> 48 MB saves ~50 MB for ~0.2 s more per level load

const engineBase = () => new URL(`${import.meta.env.BASE_URL}engine/`, document.baseURI);
/** An engine file of this build (the service worker keeps exactly these URLs for offline play). */
const engineUrl = (name: string) => { const u = new URL(name, engineBase()); u.searchParams.set('v', __ENGINE_VERSION__); return u; };

let started = false;

export async function startEngine(opts: StartOptions): Promise<EngineSession> {
  if (started) {
    throw new Error('The engine can only be started once per page; reload the page to start again.');
  }
  started = true;
  const { paks, signal } = opts;
  const report = (p: Progress) => opts.onProgress?.(p);
  const log: string[] = [];
  const push = (line: string) => {
    log.push(line);
    if (log.length > 5000) log.splice(0, 1000);
    opts.onLog?.(line);
  };

  // 1. engine side modules and data archive (redistributable, served with the page)
  const engineFiles: Array<[string, Uint8Array]> = [];
  for (const [i, [name, dst]] of ENGINE_FILES.entries()) {
    signal?.throwIfAborted();
    report({ phase: 'engine', label: name, done: i, total: ENGINE_FILES.length });
    const res = await fetch(engineUrl(name), { signal });
    if (!res.ok) throw new Error(`Engine file ${name} could not be loaded (HTTP ${res.status}).`);
    engineFiles.push([dst, new Uint8Array(await res.arrayBuffer())]);
  }

  // 2. the game archives: streamed on demand when the browser can read byte ranges synchronously
  let mode = opts.dataMode ?? 'stream';
  if (mode === 'stream' && !paks.every((p) => canStream(p.url))) mode = 'preload';
  const gameFiles: Array<[string, Uint8Array]> = [];
  if (mode === 'preload') {
    const total = paks.reduce((n, p) => n + p.size, 0);
    let done = 0;
    for (const pak of paks) {
      const res = await fetch(pak.url, { signal });
      if (!res.ok || !res.body) throw new Error(`${pak.name} could not be read (HTTP ${res.status}).`);
      const buf = new Uint8Array(pak.size);
      const reader = res.body.getReader();
      let at = 0;
      for (;;) {
        if (signal?.aborted) {
          await reader.cancel();
          signal.throwIfAborted();
        }
        const { value, done: end } = await reader.read();
        if (end) break;
        if (at + value.length > buf.length) throw new Error(`${pak.name} changed while it was being read.`);
        buf.set(value, at);
        at += value.length;
        done += value.length;
        report({ phase: 'data', label: pak.name, done, total });
      }
      if (at !== buf.length) throw new Error(`${pak.name} could not be read completely (${at} of ${buf.length} bytes).`);
      gameFiles.push([`/sof/base/${pak.name}`, buf]);
    }
  }

  // 3. load the engine runtime
  signal?.throwIfAborted();
  report({ phase: 'starting', label: 'engine', done: 0, total: 1 });
  let quitting = false;
  const net = new GatewayTransport(defaultGatewayUrl());
  const module = await loadEngineScript(opts.canvas, push, opts.onExit, () => {
    // the engine's Sys_Quit (patched to call Module.onQuit): its main loop has stopped and config.cfg has
    // just been written; store it and leave the game
    if (!quitting) {
      quitting = true;
      net.close();
      void persist().finally(() => opts.onQuit?.());
    }
  }, net, opts.moduleProps);
  const FS = module.FS;
  FS.mkdirTree('/sof/base');
  FS.mkdirTree('/sof/user');
  for (const [dst, data] of [...engineFiles, ...gameFiles]) {
    const cut = dst.lastIndexOf('/');
    FS.createDataFile(dst.slice(0, cut), dst.slice(cut + 1), data, true, false, true);
  }
  let cache: BlockCache | undefined;
  if (mode === 'stream') {
    cache = new BlockCache(opts.cacheBytes ?? DEFAULT_CACHE_BYTES, BLOCK_BYTES);
    for (const pak of paks) {
      createStreamedFile(FS, '/sof/base', pak.name, pak.url, pak.size, cache,
        (err) => opts.onExit?.(`Reading ${pak.name} failed: ${(err as Error).message}`));
    }
  }

  // 4. persistent settings and saves
  report({ phase: 'saves', label: 'settings and saves', done: 0, total: 1 });
  FS.mount(module.IDBFS, {}, '/sof/user');
  await syncfs(FS, true);
  let syncing: Promise<void> | null = null;
  // the engine writes config.cfg only on disconnect or quit, which a closing tab never reaches: write it
  // (between frames, without the engine's console message) before every store
  const persist = () => (syncing ??= (async () => {
    try {
      if (!quitting) module.ccall('Browser_StoreConfig', null, [], []);
    } catch {
      // engine not ready or stopped: store what exists
    }
    await syncfs(FS, false);
  })().finally(() => { syncing = null; }));
  setInterval(() => void persist(), 10000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) void persist(); });
  window.addEventListener('pagehide', () => void persist());

  // a save written through the game's menus or quick-save keys is stored right away
  printHooks.push((line) => {
    // the engine prints `Saving game "<name>"...` and writes the file in the same frame
    if (/^Saving game /.test(line)) setTimeout(() => void persist(), 500);
  });

  const configText = exists(FS, '/sof/user/config.cfg') ? new TextDecoder().decode(FS.readFile('/sof/user/config.cfg')) : null;
  const args = [...(opts.args?.(configText) ?? [])];
  // first start of this profile: add the browser's control defaults (gamepad buttons); the engine
  // then saves them into user/config.cfg, where the in-game key menu can change them
  if (opts.firstRunConfig && configText === null) {
    FS.writeFile('/sof/base/browser_firstrun.cfg', new TextEncoder().encode(opts.firstRunConfig));
    args.push('+exec', 'browser_firstrun.cfg');
  }
  // any + command on the command line suppresses the engine's default start (disclaimer, intro, main
  // menu), as in the original; run it explicitly
  args.push('+start');

  FS.chdir('/sof');
  report({ phase: 'starting', label: 'engine', done: 1, total: 1 });
  module.callMain(args);
  const DEST = ['game', 'console', 'message', 'menu'] as const;
  const inputState = () => {
    const v = module.ccall('Browser_InputState', 'number', [], []);
    return { dest: DEST[v & 3], inLevel: (v & 4) !== 0 };
  };
  return { module, persist, log, inputState, data: { mode, stats: cache?.stats }, net: net.stats };
}

function exists(FS: EmscriptenFS, path: string): boolean {
  try {
    FS.stat(path);
    return true;
  } catch {
    return false;
  }
}

function syncfs(FS: EmscriptenFS, populate: boolean): Promise<void> {
  return new Promise((resolve, reject) => FS.syncfs(populate, (err) => (err ? reject(err) : resolve())));
}

const printHooks: Array<(line: string) => void> = [];

function loadEngineScript(canvas: HTMLCanvasElement, print: (s: string) => void,
  onExit: ((reason: string) => void) | undefined, onQuit: () => void, net: GatewayTransport,
  props: Record<string, unknown> = {}): Promise<EmscriptenModule> {
  return new Promise((resolve, reject) => {
    const m = {
      ...props,
      canvas,
      noInitialRun: true,
      print: (s: string) => { print(s); for (const h of printHooks) h(s); },
      printErr: (s: string) => print(s),
      onQuit,
      netSend: (ip: Uint8Array, port: number, data: Uint8Array) => net.send(ip, port, data),
      netRecv: () => net.recv(),
      locateFile: (path: string) => engineUrl(path).href,
      onAbort: (what: unknown) => onExit?.(`The engine stopped: ${String(what)}`),
    } as Partial<EmscriptenModule> & { locateFile: (p: string) => string };
    m.onRuntimeInitialized = () => resolve(m as EmscriptenModule);
    (window as unknown as { Module: unknown }).Module = m;
    const script = document.createElement('script');
    script.src = engineUrl('openMerc.js').href;
    script.onerror = () => reject(new Error('The engine script could not be loaded.'));
    document.body.appendChild(script);
  });
}
