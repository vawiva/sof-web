import { buildGameSet, type SelectedFile } from './files/gameset';
import {
  canPickFolderHandle, type DirHandle, filesFromHandle, fromDataTransfer, fromFileList, pickFolderHandle, rememberedHandle,
  rememberHandle, reopenHandle,
} from './files/select';
import { GAMEPAD_BINDS, KEYBOARD_HELP, firstRunConfig } from './games/sof/controls';
import { KNOWN_EDITIONS, REQUIRED_PAKS, UNSUPPORTED_HINTS } from './games/sof/manifest';
import { presentationArgs } from './games/sof/presentation';
import { validateGameSet, validatePaks, type Validation } from './games/sof/validate';
import { httpSource } from './files/pak';
import { startGamepadNavigation } from './input/menu-gamepad';
import { DEFAULT_TOUCH, TouchControls, type TouchSettings } from './input/touch';
import { startEngine, type EngineSession, type PakFile } from './runtime/engine';
import { deleteProfile, exportProfile, importProfile, summarize } from './storage/saves';

type State = 'welcome' | 'choose' | 'validating' | 'ready' | 'error' | 'preparing' | 'running';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const startup = $('startup');
let state: State = 'welcome';
/** The chosen game data: the player's own files on this device, or the PC that serves this page (LAN host mode). */
let current: { paks: PakFile[]; handle: DirHandle | null; origin: 'local' | 'host' } | null = null;
let blobUrls: string[] = [];
let abort: AbortController | null = null;
let session: EngineSession | null = null;
const wanted = (name: string) => (REQUIRED_PAKS as readonly string[]).includes(name);

function show(next: State) {
  state = next;
  for (const el of startup.querySelectorAll<HTMLElement>('[data-state]')) {
    el.hidden = !el.dataset.state!.split(' ').includes(next === 'welcome' ? 'choose' : next);
  }
  const first = startup.querySelector<HTMLElement>('section:not([hidden]) button:not([hidden]), section:not([hidden]) .button');
  if (next !== 'running' && document.activeElement === document.body) first?.focus();
}

function fail(problems: string[]) {
  const list = $('error-list');
  list.replaceChildren(...problems.map((p) => Object.assign(document.createElement('li'), { textContent: p })));
  show('error');
  $('retry').focus();
}

// ---- capability check --------------------------------------------------------------------------
function capabilities(): Array<[string, boolean]> {
  const gl = document.createElement('canvas').getContext('webgl2');
  return [
    ['WebAssembly', typeof WebAssembly === 'object'],
    ['WebGL 2', !!gl],
    ['IndexedDB (settings and saves)', typeof indexedDB !== 'undefined'],
    ['Folder selection', 'webkitdirectory' in document.createElement('input')],
  ];
}

// ---- selection and validation --------------------------------------------------------------------
async function handleSelection(files: SelectedFile[], handle: DirHandle | null = null) {
  if (!files.length) return;
  const { set, problems } = buildGameSet(files, wanted);
  const hints = new Set<string>();
  for (const f of files) for (const h of UNSUPPORTED_HINTS) if (h.test.test(f.file.name)) hints.add(h.message);
  if (problems.length) {
    return fail([...problems.map((p) => `${p.message}${p.paths.length ? ` (${p.paths.map(sanitize).join(', ')})` : ''}`), ...hints]);
  }
  abort = new AbortController();
  show('validating');
  $('progress-title').textContent = 'Checking files…';
  ($('progress') as HTMLProgressElement).removeAttribute('value');
  $('progress-label').textContent = `Reading the archive directories of ${set.base.size} file(s).`;
  try {
    const v = await validateGameSet(set, abort.signal);
    if (v.status === 'error') return fail([...v.problems, ...hints]);
    for (const u of blobUrls) URL.revokeObjectURL(u);
    blobUrls = REQUIRED_PAKS.map((n) => URL.createObjectURL(set.base.get(n)!.file));
    current = {
      paks: REQUIRED_PAKS.map((name, i) => ({ name, size: set.base.get(name)!.file.size, url: blobUrls[i] })),
      handle, origin: 'local',
    };
    showReady(v, handle);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return show('choose');
    fail([`The files could not be read: ${(err as Error).message}`]);
  }
}

function showReady(v: Exclude<Validation, { status: 'error' }>, handle: DirHandle | null) {
  {
    const total = v.paks.reduce((n, p) => n + p.size, 0);
    const where = current?.origin === 'host' ? ' on the PC that serves this page (nothing is copied to this device)' : '';
    $('ready-summary').textContent = v.status === 'ok'
      ? `Detected${where}: ${v.edition.label}. ${v.paks.length} archives, ${(total / 1e6).toFixed(0)} MB.`
      : `Soldier of Fortune data found${where}: ${v.paks.length} archives, ${(total / 1e6).toFixed(0)} MB.`;
    $('reselect').textContent = current?.origin === 'host' ? 'Use files on this device instead' : 'Choose other files';
    const warn = $('unverified');
    warn.hidden = v.status === 'ok';
    if (v.status === 'unverified') {
      warn.textContent = 'This installation differs from the tested edition, so it is unverified: the campaign files are present, ' +
        `but problems may occur. Differences: ${v.differences.join('; ')}.`;
    }
    ($('remember') as HTMLInputElement).disabled = !handle;
    ($('remember') as HTMLInputElement).checked = !!handle;
    $('remember-row').hidden = current?.origin === 'host';
    show('ready');
    $('play').focus();
  }
}

// ---- LAN host mode: game data served by the player's own PC -----------------------------------------
interface HostManifest {
  version: number;
  files: Array<{ name: string; size: number }>;
}

/** Looks for the restricted game-data service next to this page (only present when the page is served by
 *  server/lan-host.mjs) and, if it is there, validates its archives and offers Play without a file picker. */
async function checkHostedData() {
  let manifest: HostManifest;
  try {
    const res = await fetch(new URL('gamedata/manifest.json', document.baseURI), { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return;
    manifest = await res.json();
  } catch {
    return;
  }
  if (manifest?.version !== 1 || !Array.isArray(manifest.files)) return;
  const sizes = new Map(manifest.files.filter((f) => typeof f.name === 'string' && wanted(f.name) &&
    Number.isSafeInteger(f.size) && f.size > 0).map((f) => [f.name, f.size]));
  const url = (name: string) => new URL(`gamedata/${encodeURIComponent(name)}`, document.baseURI).href;
  abort = new AbortController();
  show('validating');
  $('progress-title').textContent = 'Checking the game data on the PC…';
  ($('progress') as HTMLProgressElement).removeAttribute('value');
  $('progress-label').textContent = 'Reading the archive directories over the local network.';
  try {
    const signal = abort.signal;
    const v = await validatePaks((n) => sizes.has(n), (n) => httpSource(url(n), sizes.get(n)!, signal), signal,
      'The PC\'s game-data service does not offer it; check the folder it was started with.');
    if (v.status === 'error') return fail(v.problems.map((p) => `Game data on the PC: ${p}`));
    current = { paks: REQUIRED_PAKS.map((name) => ({ name, size: sizes.get(name)!, url: url(name) })), handle: null, origin: 'host' };
    showReady(v, null);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return show('choose');
    fail([`The game data on the PC could not be read: ${(err as Error).message}`]);
  }
}

/** Measurement switches: ?data=preload|stream and ?cache=<MB> (defaults: stream, engine default cache). */
function dataOptions() {
  const q = new URLSearchParams(location.search);
  const mode = q.get('data');
  const mb = Number(q.get('cache'));
  return {
    dataMode: mode === 'preload' || mode === 'stream' ? mode : undefined,
    cacheBytes: Number.isFinite(mb) && mb >= 8 && mb <= 1024 ? mb << 20 : undefined,
  } as const;
}

function sanitize(s: string) {
  return s.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 160);
}

// ---- running the game ----------------------------------------------------------------------------
/** The 4:3 box the game will fill, in device pixels (the whole screen when fullscreen was asked for). */
function gameBox(fullscreen: boolean) {
  const w = fullscreen ? screen.width : innerWidth;
  const h = fullscreen ? screen.height : innerHeight;
  const dpr = devicePixelRatio || 1;
  return { width: Math.round(Math.min(w, (h * 4) / 3) * dpr), height: Math.round(Math.min(h, (w * 3) / 4) * dpr) };
}

async function play(fullscreen: boolean) {
  if (!current) return;
  // fullscreen needs the click itself, so it is asked for before anything else
  if (fullscreen) await enterFullscreen();
  if (current.handle && ($('remember') as HTMLInputElement).checked) await rememberHandle(current.handle).catch(() => {});
  abort = new AbortController();
  show('preparing');
  $('progress-title').textContent = 'Preparing…';
  const bar = $('progress') as HTMLProgressElement;
  const canvas = $<HTMLCanvasElement>('canvas');
  const box = gameBox(!!document.fullscreenElement);
  // touch controls cannot work under pointer lock (it freezes pointer coordinates), so a touch session never
  // lets the engine grab the mouse
  const touch = touchWanted();
  try {
    session = await startEngine({
      canvas, paks: current.paks, ...dataOptions(), signal: abort.signal, firstRunConfig: firstRunConfig(),
      args: (configText) => presentationArgs({ configText, box, console: consoleWanted(), touch }),
      onProgress: (p) => {
        bar.max = p.total || 1;
        bar.value = p.done;
        $('progress-label').textContent = p.phase === 'data'
          ? `Reading your ${p.label}: ${(p.done / 1e6).toFixed(0)} of ${(p.total / 1e6).toFixed(0)} MB (local, not uploaded)`
          : p.phase === 'engine' ? `Loading engine: ${p.label}` : `Starting: ${p.label}`;
        if (p.phase === 'starting' && p.done === p.total) enterGame();
      },
      onExit: (reason) => gameError(reason),
      // Quit in the game's main menu: settings and saves are stored; the engine cannot start twice in one
      // page, so the startup page is loaded again
      onQuit: () => location.reload(),
    });
    (window as unknown as { __sof?: EngineSession }).__sof = session;
  } catch (err) {
    $('game').hidden = true;
    if ((err as Error).name === 'AbortError') return show('ready');
    fail([`The game could not be started: ${(err as Error).message}`]);
  }
}

async function enterFullscreen() {
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    // the page owns fullscreen: the engine's video layer (SDL) leaves fullscreen whenever it recreates its
    // window (renderer start, a resolution change), which would drop the player out of it; the player leaves
    // with the browser's own Esc / F11, which does not go through this function
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: () => Promise.resolve() });
    // Esc belongs to the game (its menu); where the browser allows it, leaving fullscreen then takes a
    // long press of Esc instead of a short one
    await (navigator as Navigator & { keyboard?: { lock?(keys: string[]): Promise<void> } }).keyboard?.lock?.(['Escape']);
  } catch {
    // refused (e.g. iOS Safari): play in the window
  }
}

function enterGame() {
  startup.hidden = true;
  $('game').hidden = false;
  show('running');
  const canvas = $<HTMLCanvasElement>('canvas');
  canvas.focus();
  const touch = loadTouch();
  if (touch.mode === 'off') return;
  const tc = new TouchControls(canvas, touch.settings);
  $('game').appendChild(tc.root);
  // automatic mode: shown while the player uses touch, hidden as soon as a keyboard, mouse or controller is used
  const auto = touch.mode === 'auto';
  let touchActive = false;
  const setVisible = (on: boolean) => {
    if (!on) tc.releaseAll();
    tc.root.classList.toggle('touch-hidden', !on);
  };
  setVisible(!auto || touchWanted());
  window.addEventListener('touchstart', () => { touchActive = true; }, true);
  window.addEventListener('touchend', () => { setTimeout(() => { touchActive = false; }, 800); }, true);
  if (auto) {
    window.addEventListener('keydown', (e) => { if (e.isTrusted) setVisible(false); }, true);
    window.addEventListener('pointerdown', (e) => { if (e.isTrusted) setVisible(e.pointerType !== 'mouse'); }, true);
    window.addEventListener('mousemove', (e) => {
      if (e.isTrusted && (e.movementX || e.movementY) && !touchActive) setVisible(false);
    }, true);
  }
  // the overlay steps aside while the game's own menus (or its console) are open
  setInterval(() => {
    if (auto && navigator.getGamepads?.().some((p) => p?.buttons.some((b) => b.pressed))) setVisible(false);
    try {
      const st = session?.inputState();
      if (st) tc.setMenuMode(st.dest !== 'game');
    } catch {
      // engine stopped
    }
  }, 150);
}

function touchWanted(): boolean {
  const { mode } = loadTouch();
  return mode === 'on' || (mode === 'auto' && matchMedia('(pointer: coarse)').matches);
}

function consoleWanted(): boolean {
  try { return localStorage.getItem('sof.console') === '1'; } catch { return false; }
}

function gameError(reason: string) {
  const box = $('game-error');
  box.hidden = false;
  box.textContent = `${reason}. Your settings and saves up to the last automatic store are kept. Reload the page to start again.`;
}

// ---- touch settings (per device) ---------------------------------------------------------------
function loadTouch(): { mode: string; settings: TouchSettings } {
  try {
    const raw = JSON.parse(localStorage.getItem('sof.touch') ?? '{}');
    return { mode: raw.mode ?? 'auto', settings: { ...DEFAULT_TOUCH, ...raw.settings } };
  } catch {
    return { mode: 'auto', settings: { ...DEFAULT_TOUCH } };
  }
}
function saveTouch(v: { mode: string; settings: TouchSettings }) {
  try { localStorage.setItem('sof.touch', JSON.stringify(v)); } catch { /* private mode: keep defaults */ }
}

// ---- wiring --------------------------------------------------------------------------------------
async function refreshProfile() {
  try {
    const s = await summarize();
    $('profile-summary').textContent = s.files
      ? `${s.files} file(s), ${(s.bytes / 1024).toFixed(0)} KB stored${s.saves.length ? `; saves: ${s.saves.join(', ')}` : ''}.`
      : 'Nothing stored yet. Settings and saves are kept in this browser after you play.';
  } catch {
    $('profile-summary').textContent = 'Browser storage is unavailable (private mode?): settings and saves will not be kept.';
  }
}

function init() {
  $('tested-edition').textContent = KNOWN_EDITIONS.map((e) => e.label).join(', ');
  $('capabilities').replaceChildren(...capabilities().map(([name, ok]) => {
    const li = document.createElement('li');
    li.textContent = ok ? name : `${name}: not available in this browser`;
    if (!ok) li.className = 'bad';
    return li;
  }));
  const help = (id: string, rows: Array<[string, string]>) => $(id).replaceChildren(...rows.flatMap(([k, v]) => [
    Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v })]));
  help('help-kbm', KEYBOARD_HELP);
  help('help-pad', GAMEPAD_BINDS.map(([, , label]) => label.split(': ') as [string, string]));

  const folder = $<HTMLInputElement>('pick-folder');
  const files = $<HTMLInputElement>('pick-files');
  folder.addEventListener('change', () => { void handleSelection(fromFileList(folder.files ?? [])); folder.value = ''; });
  files.addEventListener('change', () => { void handleSelection(fromFileList(files.files ?? [])); files.value = ''; });
  if (canPickFolderHandle()) {
    $('pick-handle').hidden = false;
    $('pick-handle').addEventListener('click', async () => {
      try {
        const h = await pickFolderHandle();
        await handleSelection(await filesFromHandle(h), h);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') fail([`The folder could not be read: ${(err as Error).message}`]);
      }
    });
    void rememberedHandle().then((h) => {
      if (!h) return;
      const b = $('continue-handle');
      b.hidden = false;
      b.textContent = `Continue with "${sanitize(h.name)}"`;
      b.addEventListener('click', async () => {
        if (!(await reopenHandle(h))) return fail(['Permission to read the remembered folder was not granted. Choose the folder again.']);
        await handleSelection(await filesFromHandle(h), h);
      });
    });
  }
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer) await handleSelection(await fromDataTransfer(e.dataTransfer));
  });
  $('cancel').addEventListener('click', () => abort?.abort());
  $('retry').addEventListener('click', () => show('choose'));
  $('reselect').addEventListener('click', () => { current = null; show('choose'); });
  $('play').addEventListener('click', () => void play(false));
  $('play-fullscreen').addEventListener('click', () => void play(true));
  if (!document.fullscreenEnabled) $('play-fullscreen').hidden = true;

  $('export-saves').addEventListener('click', async () => {
    const blob = await exportProfile();
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'sof-saves.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const imp = $<HTMLInputElement>('import-saves');
  imp.addEventListener('change', async () => {
    const f = imp.files?.[0];
    imp.value = '';
    if (!f) return;
    if (!confirm('Importing replaces settings and saves with the same names. Continue?')) return;
    try {
      const n = await importProfile(f);
      alert(`${n} file(s) imported.`);
    } catch (err) {
      alert((err as Error).message);
    }
    void refreshProfile();
  });
  $('delete-saves').addEventListener('click', async () => {
    if (!confirm('Delete all settings and saves stored by this page in this browser? Export them first if you want to keep them.')) return;
    try { await deleteProfile(); } catch (err) { alert((err as Error).message); }
    void refreshProfile();
  });

  const touch = loadTouch();
  const bind = (id: string, get: () => void) => $(id).addEventListener('input', () => { get(); saveTouch(touch); });
  ($('touch-mode') as HTMLSelectElement).value = touch.mode;
  ($('touch-scale') as HTMLInputElement).value = String(touch.settings.scale);
  ($('touch-opacity') as HTMLInputElement).value = String(touch.settings.opacity);
  ($('touch-look') as HTMLInputElement).value = String(touch.settings.lookSensitivity);
  ($('touch-left') as HTMLInputElement).checked = touch.settings.leftHanded;
  ($('touch-invert') as HTMLInputElement).checked = touch.settings.invertLook;
  bind('touch-mode', () => { touch.mode = ($('touch-mode') as HTMLSelectElement).value; });
  bind('touch-scale', () => { touch.settings.scale = Number(($('touch-scale') as HTMLInputElement).value); });
  bind('touch-opacity', () => { touch.settings.opacity = Number(($('touch-opacity') as HTMLInputElement).value); });
  bind('touch-look', () => { touch.settings.lookSensitivity = Number(($('touch-look') as HTMLInputElement).value); });
  bind('touch-left', () => { touch.settings.leftHanded = ($('touch-left') as HTMLInputElement).checked; });
  bind('touch-invert', () => { touch.settings.invertLook = ($('touch-invert') as HTMLInputElement).checked; });

  const devConsole = $<HTMLInputElement>('dev-console');
  devConsole.checked = consoleWanted();
  devConsole.addEventListener('input', () => {
    try { localStorage.setItem('sof.console', devConsole.checked ? '1' : '0'); } catch { /* private mode */ }
  });

  startGamepadNavigation(() => state !== 'running');
  void refreshProfile();
  show('welcome');
  void checkHostedData();
}

init();
