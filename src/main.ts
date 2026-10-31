import { buildGameSet, type SelectedFile } from './files/gameset';
import {
  canPickFolderHandle, type DirHandle, filesFromHandle, fromDataTransfer, fromFileList, pickFolderHandle, rememberedHandle,
  rememberHandle, reopenHandle,
} from './files/select';
import { GAMEPAD_BINDS, KEYBOARD_HELP, firstRunConfig } from './games/sof/controls';
import { KNOWN_EDITIONS, REQUIRED_PAKS, UNSUPPORTED_HINTS } from './games/sof/manifest';
import {
  DEFAULT_DISPLAY, type DisplaySettings, fitBox, frameCap, measureRefresh, parseDisplay, pictureAspect,
} from './games/sof/display';
import { presentationArgs } from './games/sof/presentation';
import { validateGameSet, validatePaks, type Validation } from './games/sof/validate';
import { httpSource } from './files/pak';
import { InputTrace, lastTrace, redact, saveTrace } from './app/diagnostics';
import { installState, promptInstall, watchInstallPrompt } from './app/install';
import { Journal, engineFrames, interpret, journalText } from './app/journal';
import { LandscapeGuard, isHandheld, lockLandscape, mustRotate, untilLandscape } from './app/orientation';
import { type Curve, type PadSettings, PAD_DEFAULTS, SETTINGS_VERSION, TOUCH_LOOK_DEFAULTS, migratePad, migrateTouchLook, padCvars } from './input/aim';
import { Calibration } from './input/calibrate';
import { GamepadAdapter, STD_AXES, STD_BUTTONS, padActions, type RawPad } from './input/gamepad';
import { startGamepadNavigation } from './input/menu-gamepad';
import { DEFAULT_TOUCH, TouchControls, parseTouch, type TouchSettings } from './input/touch';
import { startEngine, type EngineSession, type PakFile } from './runtime/engine';
import { deleteProfile, exportProfile, importProfile, summarize } from './storage/saves';
import {
  commitInstall, copyArchives, InstallError, installState as gameInstallState, removeInstall, requestPersistence, spaceCheck,
  stagedFiles, storageInfo, storageSupported, verifyInstall, type InstallSource, type InstallState as GameInstallState,
  type Installed, type WantedFile,
} from './storage/gamestore';
import { INSTALL_FORMAT } from './storage/gamestore';
import { blobSource } from './files/pak';
import { readIso } from './files/iso9660';
import { readCabHeader } from './files/iscab';
import { isWindowsProgram, readInno } from './files/gog-inno';

type State = 'welcome' | 'choose' | 'validating' | 'ready' | 'error' | 'preparing' | 'running';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const startup = $('startup');
let state: State = 'welcome';
/** The chosen game data: the player's own files on this device, or the PC that serves this page (LAN host mode). */
let current: { paks: PakFile[]; handle: DirHandle | null; origin: 'local' | 'host' | 'device' } | null = null;
/** The archives of the current selection on this device (for "keep on this device"). */
let selectedFiles: Map<string, File> | null = null;
/** Archive sizes the paired PC offers (LAN host mode), for "download and keep". */
let hostSizes: Map<string, number> | null = null;
let blobUrls: string[] = [];
let abort: AbortController | null = null;
let session: EngineSession | null = null;
const wanted = (name: string) => (REQUIRED_PAKS as readonly string[]).includes(name);
/** Installed before the engine loads: it reads controllers through this adapter (see input/gamepad.ts). */
const pads = new GamepadAdapter(window);
let calibrating: Calibration | null = null;
/** Record of the running session that survives a bad ending (app/journal.ts). */
let journal: Journal | null = null;

/** The game-data line at the top of the page. */
function setStatus(kind: 'idle' | 'ok' | 'bad', title: string, detail: string) {
  const box = $('data-status');
  box.classList.toggle('ok', kind === 'ok');
  box.classList.toggle('bad', kind === 'bad');
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
}

function show(next: State) {
  state = next;
  if (next === 'validating') setStatus('idle', 'Game data: checking…', 'Reading the archive directories.');
  if (next === 'choose') setStatus('idle', 'Game data: not selected', 'Choose your Soldier of Fortune folder below.');
  for (const el of startup.querySelectorAll<HTMLElement>('[data-state]')) {
    el.hidden = !el.dataset.state!.split(' ').includes(next === 'welcome' ? 'choose' : next);
  }
  const first = startup.querySelector<HTMLElement>('section:not([hidden]) button:not([hidden]), section:not([hidden]) .button');
  if (next !== 'running' && document.activeElement === document.body) first?.focus();
}

function fail(problems: string[]) {
  setStatus('bad', 'Game data: cannot be used', 'See the problems below.');
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
    selectedFiles = new Map(REQUIRED_PAKS.map((n) => [n, set.base.get(n)!.file]));
    void refreshDeviceInstall();
    showReady(v, handle);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return show('choose');
    fail([`The files could not be read: ${(err as Error).message}`]);
  }
}

/** The edition shown as ready (for the session journal). */
let readyEdition = '';

function showReady(v: Exclude<Validation, { status: 'error' }>, handle: DirHandle | null) {
  readyEdition = v.status === 'ok' ? v.edition.label : 'unverified installation';
  {
    const total = v.paks.reduce((n, p) => n + p.size, 0);
    const where = current?.origin === 'host' ? ' on the PC that serves this page (nothing is copied to this device)'
      : current?.origin === 'device' ? ' stored on this device' : '';
    $('ready-summary').textContent = v.status === 'ok'
      ? `Detected${where}: ${v.edition.label}. ${v.paks.length} archives, ${(total / 1e6).toFixed(0)} MB.`
      : `Soldier of Fortune data found${where}: ${v.paks.length} archives, ${(total / 1e6).toFixed(0)} MB.`;
    $('reselect').textContent = current?.origin === 'local' ? 'Choose other files' : 'Use other files on this device instead';
    setStatus('ok', `Ready: ${v.status === 'ok' ? v.edition.label : 'Soldier of Fortune (unverified installation)'}`,
      current?.origin === 'host' ? 'Game data served by your PC over the local network; nothing is copied to this device.'
        : current?.origin === 'device' ? 'Ready on this device: no file selection, pairing or PC needed for single-player.'
          : 'Game data from this device; read locally, never uploaded.');
    const warn = $('unverified');
    warn.hidden = v.status === 'ok';
    if (v.status === 'unverified') {
      warn.textContent = 'This installation differs from the tested edition, so it is unverified: the campaign files are present, ' +
        `but problems may occur. Differences: ${v.differences.join('; ')}.`;
    }
    ($('remember') as HTMLInputElement).disabled = !handle;
    ($('remember') as HTMLInputElement).checked = !!handle;
    $('remember-row').hidden = current?.origin !== 'local';
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
  $('host-problem').hidden = true;
  // an installed app, or a browser that used the PC's data before, expects the host: explain when it is missing
  const installed = current?.origin === 'device';
  const expectHost = !installed && (installState().standalone || remembered('sof.hostmode'));
  try {
    const res = await fetch(new URL('gamedata/manifest.json', document.baseURI), { cache: 'no-store' });
    if (res.status === 403) {
      if (installed) return;
      return hostProblem('This device is not paired with your PC',
        'The PC refused the game data: this app or browser has not been paired yet, or the PC\'s tester key changed ' +
        '(it changes at every start of the LAN host unless SOF_LAN_KEY is set). Pair again with the pairing code shown ' +
        'on the PC.', true);
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) {
      if (expectHost) hostProblem('Your PC does not offer the game data', `The page answered, but without game data (HTTP ${res.status}). Start the LAN host on the PC with the --data folder.`);
      return;
    }
    manifest = await res.json();
  } catch {
    if (expectHost) {
      hostProblem('Your PC is not reachable',
        'Check that the PC is on and the LAN host is running, and that this device is on the same Wi-Fi. If the PC\'s ' +
        'network address changed, open the new address printed by the LAN host in Safari and add the app to the Home ' +
        'Screen again (an installed app keeps the address it was added from). If Safari reports a certificate problem, ' +
        'install and trust the PC\'s certificate first (Help → Play on a phone).');
    }
    return;
  }
  remember('sof.hostmode');
  if (manifest?.version !== 1 || !Array.isArray(manifest.files)) return;
  const sizes = new Map(manifest.files.filter((f) => typeof f.name === 'string' && wanted(f.name) &&
    Number.isSafeInteger(f.size) && f.size > 0).map((f) => [f.name, f.size]));
  hostSizes = REQUIRED_PAKS.every((n) => sizes.has(n)) ? sizes : null;
  void refreshDeviceInstall();
  // the copy stored on this device is used; the PC's data stays available for downloading it again
  if (installed) return;
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

// ---- the game kept on this device (storage/gamestore.ts) ------------------------------------------------------
let deviceState: GameInstallState = { kind: 'none' };
let installAbort: AbortController | null = null;
/** The source of an interrupted install, while this page still has it (files cannot be re-read after a reload). */
let lastSource: { source: InstallSource; files: WantedFile[]; label: string } | null = null;
const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`;

async function refreshDeviceInstall(): Promise<GameInstallState> {
  const panel = $('device-install');
  if (!storageSupported()) {
    panel.hidden = false;
    $('inst-status').textContent = 'This browser cannot keep the game data (no private file storage for this page).';
    for (const id of ['inst-actions', 'inst-manage']) $(id).hidden = true;
    return deviceState = { kind: 'none' };
  }
  panel.hidden = false;
  if (!installAbort) deviceState = await gameInstallState();
  const st = deviceState;
  const busy = !!installAbort;
  $('inst-status').textContent = st.kind === 'ready'
    ? `Stored on this device: ${st.installed.manifest.editionLabel}, ${mb(st.installed.manifest.files.reduce((n, f) => n + f.size, 0))}, ` +
      `kept since ${new Date(st.installed.manifest.installedAt).toLocaleDateString()}. Plays without the PC.`
    : st.kind === 'damaged' ? `The stored game data is incomplete (${st.problems.join(' ')}) Import it again or remove it.`
      : st.kind === 'partial' ? `An import was interrupted: ${st.doneFiles.length} of ${REQUIRED_PAKS.length} archives complete, ` +
        `${mb(st.storedBytes)} stored. It is not playable until it is finished.`
        : 'Not stored on this device. Keep it here to play without file selection or the PC.';
  const ready = st.kind === 'ready';
  $('inst-current').hidden = busy || ready || current?.origin !== 'local' || !selectedFiles;
  $('inst-pc').hidden = busy || !hostSizes;
  $('inst-pc').textContent = ready ? 'Download again from my PC' : 'Download and keep the game from my PC';
  $('inst-pick-label').hidden = busy;
  $('inst-resume').hidden = busy || st.kind !== 'partial' || !lastSource;
  $('inst-verify').hidden = busy || !ready;
  $('inst-remove').hidden = busy || st.kind === 'none';
  $('inst-origin').textContent = `Kept for this address only (${location.origin}). Another address — a new LAN address ` +
    'or a public website — has its own separate storage: import the game there again, and move saves with Export / Import.';
  const info = await storageInfo();
  $('inst-storage').textContent = [
    info.usage !== null && info.quota !== null ? `This site uses ${mb(info.usage)} of ${mb(info.quota)} the browser allows it.` : 'Storage use unknown.',
    info.persisted === true ? 'Kept persistently (the browser will not clear it on its own).'
      : info.persisted === false ? 'Not marked persistent: the browser may clear it when the device runs out of space.' : '',
  ].filter(Boolean).join(' ');
  return st;
}

/** Plays from the stored copy: the archives are streamed from storage like selected files (nothing loaded whole). */
async function useInstalled(inst: Installed) {
  const v = await validatePaks((n) => inst.files.has(n), (n) => blobSource(inst.files.get(n)!));
  if (v.status === 'error') {
    $('inst-problem').hidden = false;
    $('inst-problem').textContent = `The stored game data cannot be used: ${v.problems.join(' ')} Import it again or remove it.`;
    return false;
  }
  for (const u of blobUrls) URL.revokeObjectURL(u);
  blobUrls = REQUIRED_PAKS.map((n) => URL.createObjectURL(inst.files.get(n)!));
  current = { paks: REQUIRED_PAKS.map((name, i) => ({ name, size: inst.files.get(name)!.size, url: blobUrls[i] })), handle: null, origin: 'device' };
  $('host-problem').hidden = true;
  showReady(v, null);
  return true;
}

function installProblem(text: string | null) {
  $('inst-problem').hidden = !text;
  $('inst-problem').textContent = text ?? '';
}

/** Copies, verifies, validates and commits; the stored copy then replaces the current source. */
async function runInstall(source: InstallSource, files: WantedFile[], label: string) {
  installProblem(null);
  lastSource = { source, files, label };
  const space = await spaceCheck(files);
  if (!space.enough) {
    return installProblem(`Not enough storage: ${mb(space.needed)} more are needed, but the browser allows this site only ` +
      `${mb(space.available ?? 0)} more. Free space on the device (or remove other site data) and try again.`);
  }
  const persisted = await requestPersistence();
  installAbort = new AbortController();
  $('inst-run').hidden = false;
  const bar = $<HTMLProgressElement>('inst-progress');
  void refreshDeviceInstall();
  try {
    const copied = await copyArchives(source, files, (p) => {
      bar.max = p.total || 1;
      bar.value = p.done;
      $('inst-label').textContent = `${label}: ${p.phase === 'verify' ? 'checking' : 'copying'} ${p.file} — ` +
        `${mb(p.done)} of ${mb(p.total)}`;
    }, installAbort.signal);
    $('inst-label').textContent = 'Identifying the edition…';
    const stored = await stagedFiles(files.map((f) => f.name));
    const v = await validatePaks((n) => stored.has(n), (n) => blobSource(stored.get(n)!));
    if (v.status === 'error') {
      installProblem(`The copied files are not a usable Soldier of Fortune installation: ${v.problems.join(' ')} ` +
        'They were not made playable; remove them below.');
      return;
    }
    await commitInstall({
      format: INSTALL_FORMAT, game: 'sof1', editionId: v.status === 'ok' ? v.edition.id : null,
      editionLabel: v.status === 'ok' ? v.edition.label : 'Soldier of Fortune (unverified installation)',
      source: source.kind, installedAt: new Date().toISOString(), files: copied,
    });
    lastSource = null;
    if (persisted === false) installProblem('Stored. The browser did not mark this site\'s storage as persistent, so it may clear it when space runs low; keep your game files or the PC available for a re-import.');
  } catch (err) {
    const e = err as InstallError;
    installProblem(e.code === 'cancelled' ? 'Cancelled. What was copied is kept: Resume continues from there (while this page stays open), or remove it below.'
      : e.code === 'quota' ? 'The device ran out of storage for this site. Free space and press Resume, or remove the partial copy.'
        : `The import stopped: ${e.message}`);
  } finally {
    installAbort = null;
    $('inst-run').hidden = true;
    const st = await refreshDeviceInstall();
    if (st.kind === 'ready' && current?.origin !== 'device') await useInstalled(st.installed);
  }
}

/** The import picker: the five archives, or the 2001 CD image (its InstallShield set is read, nothing is run). */
async function importPicked(list: File[]) {
  installProblem(null);
  const iso = list.find((f) => /\.iso$/i.test(f.name));
  if (iso) {
    try {
      const img = await readIso(blobSource(iso));
      const hdr = img.find('Setup/data1.hdr');
      const cab = img.find('Setup/data1.cab');
      if (!hdr || !cab) return installProblem('This disc image has no Soldier of Fortune InstallShield set (Setup/data1.hdr and data1.cab). Only the 2001 Platinum CD layout is supported.');
      const set = readCabHeader(await img.open(hdr).read(0, hdr.size), cab.size);
      const paths: Record<string, string> = {};
      const files: WantedFile[] = [];
      for (const n of REQUIRED_PAKS) {
        const f = set.files.find((x) => x.path.toLowerCase() === `base/${n}`);
        if (!f) return installProblem(`The disc image's installer has no base/${n}: not a supported Soldier of Fortune disc.`);
        paths[n] = f.path;
        files.push({ name: n, size: f.expandedSize });
      }
      return runInstall({ kind: 'disc-image', file: iso, paths }, files, 'Unpacking the disc image');
    } catch (err) {
      return installProblem(`The disc image cannot be read: ${(err as Error).message}`);
    }
  }
  const exe = list.find((f) => /\.exe$/i.test(f.name));
  if (exe) {
    // the GOG installer is read like an archive (files/gog-inno.ts); nothing of it runs
    try {
      if (!(await isWindowsProgram(blobSource(exe)))) return installProblem('This .exe file is not a Windows program.');
      const set = await readInno(blobSource(exe));
      const paths: Record<string, string> = {};
      const files: WantedFile[] = [];
      for (const n of REQUIRED_PAKS) {
        const t = set.targets.get(`base/${n}`);
        if (!t) return installProblem(`The installer has no base/${n}: not a Soldier of Fortune installer this page can read.`);
        paths[n] = t.path;
        files.push({ name: n, size: t.size });
      }
      return runInstall({ kind: 'gog-installer', file: exe, paths }, files, 'Unpacking the GOG installer');
    } catch (err) {
      return installProblem(`This installer cannot be read: ${(err as Error).message}. Supported: the GOG installer of Soldier of Fortune ` +
        '(Inno Setup 5.6.2, one file), the 2001 Platinum CD image, or the five .pak files.');
    }
  }
  const { set, problems } = buildGameSet(fromFileList(list), wanted);
  if (problems.length) return installProblem(problems.map((p) => p.message).join(' '));
  const missing = REQUIRED_PAKS.filter((n) => !set.base.has(n));
  if (missing.length) return installProblem(`Missing: ${missing.join(', ')}. Select all five archives at once (or the CD image).`);
  const files = REQUIRED_PAKS.map((n) => set.base.get(n)!.file);
  return runInstall({ kind: 'files', files: Object.fromEntries(REQUIRED_PAKS.map((n, i) => [n, files[i]])) },
    REQUIRED_PAKS.map((n, i) => ({ name: n, size: files[i].size })), 'Copying your files');
}

function setupDeviceInstall() {
  $('inst-current').addEventListener('click', () => {
    if (!selectedFiles) return;
    const f = selectedFiles;
    void runInstall({ kind: 'files', files: Object.fromEntries(f) }, REQUIRED_PAKS.map((n) => ({ name: n, size: f.get(n)!.size })), 'Copying your files');
  });
  $('inst-pc').addEventListener('click', () => {
    if (!hostSizes) return;
    const sizes = hostSizes;
    const urls = Object.fromEntries(REQUIRED_PAKS.map((n) => [n, new URL(`gamedata/${encodeURIComponent(n)}`, document.baseURI).href]));
    void runInstall({ kind: 'lan', urls }, REQUIRED_PAKS.map((n) => ({ name: n, size: sizes.get(n)! })), 'Downloading from your PC');
  });
  const pick = $<HTMLInputElement>('inst-pick');
  pick.addEventListener('change', () => { const l = [...(pick.files ?? [])]; pick.value = ''; if (l.length) void importPicked(l); });
  $('inst-resume').addEventListener('click', () => { if (lastSource) void runInstall(lastSource.source, lastSource.files, lastSource.label); });
  $('inst-cancel').addEventListener('click', () => installAbort?.abort());
  $('inst-verify').addEventListener('click', async () => {
    installProblem(null);
    installAbort = new AbortController();
    $('inst-run').hidden = false;
    void refreshDeviceInstall();
    const bar = $<HTMLProgressElement>('inst-progress');
    try {
      const r = await verifyInstall((p) => { bar.max = p.total; bar.value = p.done; $('inst-label').textContent = `Checking ${p.file} — ${mb(p.done)} of ${mb(p.total)}`; }, installAbort.signal);
      installProblem(r.ok ? 'All stored archives are intact.' : `Problems: ${r.problems.join(' ')} Import the game again (or download it from your PC) to repair it.`);
    } catch (err) {
      installProblem(`The check stopped: ${(err as Error).message}`);
    } finally {
      installAbort = null;
      $('inst-run').hidden = true;
      void refreshDeviceInstall();
    }
  });
  $('inst-remove').addEventListener('click', async () => {
    if (!confirm('Remove the game data stored on this device? Your saves and settings are kept.')) return;
    await removeInstall().catch((err: Error) => installProblem(`Could not remove it: ${err.message}`));
    lastSource = null;
    if (current?.origin === 'device') {
      current = null;
      setStatus('idle', 'Game data: not selected', 'Choose your Soldier of Fortune folder below.');
      show('choose');
      void checkHostedData();
    }
    await refreshDeviceInstall();
  });
}

/** The stored copy first; otherwise the PC (LAN host mode) or the file picker. */
async function startDataSources() {
  setupDeviceInstall();
  const st = await refreshDeviceInstall().catch(() => ({ kind: 'none' }) as GameInstallState);
  if (st.kind === 'ready') await useInstalled(st.installed).catch(() => false);
  void checkHostedData();
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
/** The picture's shape and the box the game will fill, in device pixels (the whole screen when fullscreen was
 *  asked for): 4:3 as the original unless widescreen was chosen in Browser settings. */
function gameBox(fullscreen: boolean, display: DisplaySettings) {
  // inside the device's safe area (notches, rounded corners), as the canvas is placed (style.css #game)
  const probe = document.body.appendChild(document.createElement('div'));
  probe.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) ' +
    'env(safe-area-inset-bottom) env(safe-area-inset-left)';
  const cs = getComputedStyle(probe);
  const insetW = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) || 0;
  const insetH = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) || 0;
  probe.remove();
  const w = (fullscreen ? screen.width : innerWidth) - insetW;
  const h = (fullscreen ? screen.height : innerHeight) - insetH;
  const dpr = devicePixelRatio || 1;
  const aspect = pictureAspect(display.aspect, w, h);
  return { aspect, ...fitBox(aspect, w * dpr, h * dpr) };
}

/** The display's refresh rate, measured once on the startup page (0 = unknown). */
let displayHz: Promise<number> = Promise.resolve(0);

async function play(fullscreen: boolean) {
  if (!current || installState().gate) return;
  // fullscreen needs the click itself, so it is asked for before anything else; a handheld device then asks for
  // landscape (Android allows the lock in fullscreen only; elsewhere the rotate screen asks the player)
  if (fullscreen) await enterFullscreen();
  if (isHandheld()) await lockLandscape();
  if (current.handle && ($('remember') as HTMLInputElement).checked) await rememberHandle(current.handle).catch(() => {});
  abort = new AbortController();
  if (mustRotate(isHandheld(), innerWidth, innerHeight)) {
    $('rotate-note').textContent = 'The game starts when the device is held sideways.';
    $('rotate').hidden = false;
    try {
      await untilLandscape(() => isHandheld(), abort.signal);
    } catch {
      return show('ready');
    } finally {
      $('rotate').hidden = true;
    }
  }
  show('preparing');
  const data = `${current.origin === 'host' ? 'streamed from the PC' : current.origin === 'device' ? 'stored on this device' : 'selected files'}, ${readyEdition}`;
  journal = new Journal(`${await buildInfo()}; game data ${data}`);
  journal.setStage('loading the engine');
  journal.add(`play: game data ${data}; ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '')}`);
  journal.flush(true);
  $('progress-title').textContent = 'Preparing…';
  const bar = $('progress') as HTMLProgressElement;
  const canvas = $<HTMLCanvasElement>('canvas');
  const display = loadDisplay();
  const box = gameBox(!!document.fullscreenElement, display);
  // the canvas keeps this shape whatever the window does later (rotation, resizing): black bars, never stretching
  $('game').style.setProperty('--aspect', String(box.aspect));
  const hz = await displayHz;
  // touch controls cannot work under pointer lock (it freezes pointer coordinates), so a touch session never
  // lets the engine grab the mouse
  const touch = touchWanted();
  try {
    session = await startEngine({
      canvas, paks: current.paks, ...dataOptions(), signal: abort.signal, firstRunConfig: firstRunConfig(),
      args: (configText) => [
        ...presentationArgs({ configText, box, console: consoleWanted(), touch }),
        // the engine cannot ask a browser for the refresh rate (SDL reports 60): its frame pacing uses this one
        ...(hz ? ['+set', 'vid_displayrefreshrate', String(hz)] : []),
      ],
      moduleProps: { wideAspect: box.aspect > 4 / 3 + 1e-3 ? box.aspect : 0, frameCap: frameCap(display.fps, hz) },
      onProgress: (p) => {
        bar.max = p.total || 1;
        bar.value = p.done;
        $('progress-label').textContent = p.phase === 'data'
          ? `Reading your ${p.label}: ${(p.done / 1e6).toFixed(0)} of ${(p.total / 1e6).toFixed(0)} MB (local, not uploaded)`
          : p.phase === 'engine' ? `Loading engine: ${p.label}` : `Starting: ${p.label}`;
        if (p.phase === 'starting' && p.done === p.total) enterGame();
      },
      onLog: (line) => journalLine(line),
      onExit: (reason) => gameError(reason),
      // Quit in the game's main menu: settings and saves are stored; the engine cannot start twice in one
      // page, so the startup page is loaded again
      onQuit: () => { journal?.end('quit through the game menu'); location.reload(); },
    });
    (window as unknown as { __sof?: EngineSession }).__sof = session;
    applyPadSettings();
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

const engineCall = (name: string, args: number[] = []) => {
  try {
    return session?.module.ccall(name, 'number', args.map(() => 'number'), args) ?? 0;
  } catch {
    return 0; // engine stopped
  }
};
const engineCmd = (text: string) => {
  try { session?.module.ccall('Cbuf_AddText', null, ['string'], [`${text}\n`]); } catch { /* engine stopped */ }
};

/** Controller settings of this page, applied to the engine's joy_* variables at every start. */
function applyPadSettings() {
  engineCmd(padCvars(loadPad()));
}

let touchControls: TouchControls | null = null;

function enterGame() {
  startup.hidden = true;
  $('game').hidden = false;
  show('running');
  const canvas = $<HTMLCanvasElement>('canvas');
  canvas.focus();
  journal?.setStage('starting');
  watchSession(canvas);
  const touch = loadTouch();
  const releaseInputs = () => {
    touchControls?.releaseAll();
    engineCall('Browser_Move', [0, 0]);
  };
  // landscape-only play on phones and tablets (app/orientation.ts)
  new LandscapeGuard({
    state: () => {
      if (!session) return null;
      const v = engineCall('Browser_InputState');
      return { inLevel: (v & 4) !== 0, multiplayer: (v & 8) !== 0, paused: (v & 16) !== 0 };
    },
    pause: (on) => engineCmd(`set paused ${on ? 1 : 0}`),
    releaseInputs,
  }, { rotate: $('rotate'), resume: $('resume'), note: $('rotate-note') });
  if (diagWanted()) startLiveDiagnostics();
  startTrace();
  if (touch.mode === 'off') return;
  const tc = new TouchControls(canvas, touch.settings, {
    look: (yaw, pitch, aim) => engineCall('Browser_Look', [yaw, pitch, aim]),
    move: (forward, right) => engineCall('Browser_Move', [forward, right]),
  });
  touchControls = tc;
  $('game').appendChild(tc.root);
  // shown: the touch controls; hidden: invisible, but touches are still caught (they would reach the game as
  // mouse clicks, i.e. fire) and in automatic mode a touch shows them again; off: out of the mouse's way
  const setState = (st: 'shown' | 'hidden' | 'off') => {
    if (st !== 'shown') tc.releaseAll();
    tc.root.classList.toggle('touch-hidden', st === 'hidden');
    tc.root.classList.toggle('touch-off', st === 'off');
    tc.setPassive(st !== 'shown');
    tc.root.dataset.state = st;
  };
  const handheld = isHandheld();
  if (touch.mode === 'touch') setState('shown');
  else if (touch.mode === 'controller') setState('hidden');
  else {
    setState(touchWanted() ? 'shown' : 'off');
    // automatic: the last kind of input used decides; only real input counts (the overlay's own key and mouse
    // events are synthetic, touches produce no pointer events of type "mouse", and controller drift is ignored)
    // a touch shows them again, except within 3 s of controller input (a thumb brushing the screen while playing
    // with the controller); while hidden for a controller, touches in play do nothing
    let padUsedAt = -Infinity;
    window.addEventListener('pointerdown', (e) => {
      if (e.isTrusted && e.pointerType === 'touch' && tc.root.dataset.state !== 'shown' &&
        performance.now() - padUsedAt > 3000) setState('shown');
    }, true);
    window.addEventListener('pointermove', (e) => {
      if (e.isTrusted && e.pointerType === 'mouse' && (e.movementX || e.movementY) && tc.root.dataset.state === 'shown') setState('off');
    }, true);
    window.addEventListener('keydown', (e) => { if (e.isTrusted && tc.root.dataset.state === 'shown') setState('off'); }, true);
    // the controller hides them only once the game is seen to receive its input (the game has the controller open
    // and holds the pressed button or the pushed stick): a controller that is connected but whose input does not
    // reach the game leaves the touch controls in place
    pads.onActivity = () => {
      const v = pads.status().virtual;
      if (!v || !engineCall('Browser_PadState', [0])) return;
      const keys = engineCall('Browser_PadState', [6]);
      const pressed = v.buttons.reduce((m, b, i) => m | (b.pressed ? 1 << i : 0), 0);
      const sticks = [1, 2, 3, 4].some((i) => Math.abs(engineCall('Browser_PadState', [i])) > 0.3 * 32768);
      if ((pressed & keys) === 0 && !sticks) return;
      padUsedAt = performance.now();
      if (tc.root.dataset.state === 'shown') setState(handheld ? 'hidden' : 'off');
    };
    // controller gone: whatever it held is released by the engine (it pauses a single-player game); the touch
    // controls come back on touch screens
    pads.onConnection = (pad) => {
      if (pad) return;
      padUsedAt = -Infinity;
      releaseInputs();
      if (touchWanted() && tc.root.dataset.state !== 'shown') setState('shown');
    };
  }
  // the overlay steps aside while the game's own menus (or its console) are open
  setInterval(() => tc.setMenuMode((engineCall('Browser_InputState') & 3) !== 0), 150);
}

function touchWanted(): boolean {
  const { mode } = loadTouch();
  return mode === 'touch' || (mode === 'auto' && matchMedia('(pointer: coarse)').matches);
}

function consoleWanted(): boolean {
  try { return localStorage.getItem('sof.console') === '1'; } catch { return false; }
}

function diagWanted(): boolean {
  try { return localStorage.getItem('sof.inputdiag') === '1'; } catch { return false; }
}

function gameError(reason: string) {
  journal?.add(`error: ${reason}`);
  journal?.flush(true);
  $('game-error').hidden = false;
  $('game-error-text').textContent = `${reason}. Your settings and saves up to the last automatic store are kept.`;
}

/** Back to the start page from a failed session: what can still be stored is stored first. */
async function leaveToStart(reason: string) {
  journal?.end(reason);
  await Promise.race([session?.persist().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  location.reload();
}

/** Engine console lines worth keeping in the journal: level loads, map changes, saves and errors. */
let journalMap = '';
function journalLine(line: string) {
  if (!journal) return;
  const m = /^Map: (\w+)/.exec(line);
  if (m) journalMap = m[1];
  if (m || /^-+ Server Initialization|^(Changing map|ERROR|Error|Sys_Error)|: (error|failed)/i.test(line) || /^(Saving|Loading) game/.test(line)) {
    journal.add(`engine: ${line.trim()}`);
  }
}

/** Watches the running session for the journal: game state changes, frame stalls, data reads, skip presses, graphics
 *  context loss and page lifecycle; a 2 s heartbeat stores it. */
function watchSession(canvas: HTMLCanvasElement) {
  const j = journal;
  if (!j) return;
  let lastState = -1;
  let lastStats = { requests: 0, bytesFetched: 0 };
  const mapName = () => { try { return session?.module.ccall('Browser_MapName', 'string', [], []) || journalMap; } catch { return journalMap; } };
  const describe = (v: number) => (v < 0 ? 'starting' : [
    (v & 4 ? mapName() : '') || 'no map', ['play', 'console', 'message', 'menu'][v & 3], v & 4 ? 'level running' : 'no level',
    v & 16 ? 'paused' : '', v & 32 ? 'cinematic' : '', v & 8 ? 'multiplayer' : ''].filter(Boolean).join(', '));
  const frame = (t: number) => {
    const gap = t - j.lastFrame;
    if (gap > 1500 && !document.hidden) j.add(`no frame drawn for ${(gap / 1000).toFixed(1)} s (${describe(lastState)})`);
    if (gap > 10000 && !document.hidden) j.trouble(`no frame drawn for ${(gap / 1000).toFixed(0)} s`);
    j.lastFrame = t;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // stuck detection: how long the current cinematic / level load / pause-in-cinematic has lasted, and an engine
  // snapshot (Browser_Probe) every 10 s while it lasts, so a report tells a stopped simulation, a pause, a
  // cinematic being fast-forwarded without end and a stalled load apart
  const probe = () => { try { return String(session?.module.ccall('Browser_Probe', 'string', [], []) ?? ''); } catch { return 'no probe'; } };
  let hadLevel = false, cinSince = 0, loadSince = 0, pausedCinSince = 0, lastProbe = 0;
  setInterval(() => {
    const v = engineCall('Browser_InputState');
    if (v !== lastState) {
      lastState = v;
      j.setStage(describe(v));
    }
    const now = performance.now();
    const cin = (v & 32) !== 0, inLevel = (v & 4) !== 0, mp = (v & 8) !== 0;
    hadLevel ||= inLevel;
    cinSince = cin ? cinSince || now : 0;
    loadSince = hadLevel && !inLevel && !mp ? loadSince || now : 0;
    pausedCinSince = cin && (v & 16) ? pausedCinSince || now : 0;
    if ((cinSince || loadSince) && !document.hidden && now - lastProbe > 10000) {
      lastProbe = now;
      j.add(`probe (${cin ? `cinematic ${((now - cinSince) / 1000).toFixed(0)} s` : `no level ${((now - loadSince) / 1000).toFixed(0)} s`}): ${probe()}`);
    }
    if (!j.troubled && !document.hidden) {
      if (cinSince && now - cinSince > 120000) j.trouble(`a cinematic has not ended for 2 minutes (${describe(v)}; ${probe()})`);
      else if (loadSince && now - loadSince > 60000) j.trouble(`no level for 1 minute after one had run (${describe(v)}; ${probe()})`);
      else if (pausedCinSince && now - pausedCinSince > 30000) j.trouble(`paused during a cinematic for 30 s (${probe()})`);
    }
    const st = session?.data.stats;
    if (st) {
      const bytes = st.bytesFetched - lastStats.bytesFetched;
      if (bytes > 4 << 20) j.add(`data read: ${(bytes / 1e6).toFixed(0)} MB in ${st.requests - lastStats.requests} requests`);
      lastStats = { requests: st.requests, bytesFetched: st.bytesFetched };
    }
  }, 500);
  setInterval(() => j.beat(), 2000);
  // Esc (the keyboard, the touch Menu button) skips a cinematic or opens the menu
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.repeat) j.add(`Esc pressed (${describe(lastState)})`); }, true);
  // the controller's Start (standard mapping 9) skips a cinematic or opens the menu; A/B and the triggers as well
  // during a cinematic (use skips it there)
  pads.onPress = (b) => {
    if (b === 9 || (lastState & 32)) j.add(`controller button ${b} pressed (${describe(lastState)})`);
  };
  document.addEventListener('pointerlockchange', () => j.add(document.pointerLockElement ? 'mouse captured' : 'mouse released'));
  window.addEventListener('blur', () => j.add('window lost focus'));
  canvas.addEventListener('webglcontextlost', () => {
    j.add('graphics context lost');
    gameError("The browser took the game's graphics away (this often happens when the device runs low on memory)");
  });
  // an engine fault (a WebAssembly trap) thrown out of the game loop ends that loop without an abort: the last frame
  // would stay on screen with no input answered. The report keeps where it happened; the player gets the error screen.
  const failed = (err: unknown, message: string) => {
    j.add(`page error: ${message}`);
    const where = engineFrames(err);
    for (let i = 0; i < where.length; i += 150) j.add(`engine stack: ${where.slice(i, i + 150)}`);
    if (err instanceof WebAssembly.RuntimeError && session) {
      j.trouble(`the game engine failed: ${err.message}${where ? ` in ${where.split(' < ')[0]}` : ''}`);
      gameError(`The game engine failed (${err.message})`);
    }
  };
  window.addEventListener('error', (e) => failed(e.error, e.message));
  window.addEventListener('unhandledrejection', (e) => failed(e.reason, String((e.reason as Error)?.message ?? e.reason)));
  document.addEventListener('visibilitychange', () => { j.add(document.hidden ? 'app in the background' : 'app in the foreground'); j.flush(true); });
  window.addEventListener('pagehide', () => j.end('page closed or reloaded'));
}

// ---- touch and controller settings (per device) ------------------------------------------------------
type InputMode = 'auto' | 'touch' | 'controller' | 'off';
/** Stored touch settings, brought to the current version (input/aim.ts): look speeds still at the old defaults move to
 *  the new ones; chosen values stay and are listed in `custom`. */
function loadTouch(): { mode: InputMode; settings: TouchSettings; custom: string[] } {
  try {
    const raw = JSON.parse(localStorage.getItem('sof.touch') ?? '{}') ?? {};
    const mode = raw.mode === 'on' ? 'touch' : raw.mode; // 'on' in earlier versions
    const m = migrateTouchLook(raw.settings ?? {}, typeof raw.v === 'number' ? raw.v : 1);
    return { mode: ['auto', 'touch', 'controller', 'off'].includes(mode) ? mode : 'auto', settings: parseTouch(m.value), custom: m.custom };
  } catch {
    return { mode: 'auto', settings: { ...DEFAULT_TOUCH }, custom: [] };
  }
}
function saveTouch(v: { mode: InputMode; settings: TouchSettings }) {
  try { localStorage.setItem('sof.touch', JSON.stringify({ v: SETTINGS_VERSION, mode: v.mode, settings: v.settings })); } catch { /* private mode: keep defaults */ }
}

function loadPadState(): { pad: PadSettings; custom: string[] } {
  try {
    const raw = JSON.parse(localStorage.getItem('sof.pad') ?? '{}') ?? {};
    const m = migratePad(raw, typeof raw.v === 'number' ? raw.v : 1);
    return { pad: m.value, custom: m.custom };
  } catch {
    return { pad: { ...PAD_DEFAULTS }, custom: [] };
  }
}
function loadPad(): PadSettings {
  return loadPadState().pad;
}
function savePad(v: PadSettings) {
  try { localStorage.setItem('sof.pad', JSON.stringify({ v: SETTINGS_VERSION, ...v })); } catch { /* private mode */ }
}

// ---- input diagnostics ---------------------------------------------------------------------------------
const fmt = (v: number) => (v >= 0 ? ' ' : '') + v.toFixed(2);

/** What the engine holds for the controller and what the game is doing (only while it runs). */
function engineSnapshot() {
  const v = engineCall('Browser_InputState');
  const paused = (v & 16) !== 0;
  const dest = ['play', 'console', 'message', 'menu'][v & 3];
  return {
    open: engineCall('Browser_PadState', [0]) === 1,
    axes: [1, 2, 3, 4].map((i) => engineCall('Browser_PadState', [i]) / 32768),
    keys: engineCall('Browser_PadState', [6]),
    state: !(v & 4) && dest === 'play' ? 'no level' : paused && dest === 'play' ? 'paused'
      : (v & 32) && dest === 'play' ? 'cinematic' : dest,
    // play takes input: a level runs, no menu or console, not paused, no scripted cinematic holding the controls
    inGame: (v & 3) === 0 && (v & 4) !== 0 && !paused && !(v & 32),
    multiplayer: (v & 8) !== 0,
  };
}

function diagnosticsText(engine = false): string {
  const st = pads.status();
  const nav = navigator as Navigator & { standalone?: boolean };
  const lines = [
    `Soldier of Fortune Web input report, ${new Date().toISOString()}`,
    `Page: ${location.origin}${location.pathname} (${current?.origin === 'host' ? 'game data from the PC' : current?.origin === 'device' ? 'game data stored on this device' : current ? 'game data from this device' : 'no game data selected'})`,
    `Browser: ${navigator.userAgent}`,
    `Secure context (HTTPS): ${st.secure ? 'yes' : 'NO - browsers hide controllers on plain http addresses; use the https link'}`,
    `Gamepad API: ${st.supported ? 'available' : 'NOT available in this browser or page'}`,
    `Installed app: ${installState().standalone ? 'yes (Home Screen)' : 'no (browser tab)'}; navigator.standalone=${String(nav.standalone)}; ` +
      `display-mode standalone=${matchMedia('(display-mode: standalone)').matches}; fullscreen element=${!!document.fullscreenElement}`,
    `Input mode: ${loadTouch().mode}; touch screen: ${matchMedia('(pointer: coarse)').matches ? 'yes' : 'no'}; handheld: ${isHandheld() ? 'yes' : 'no'}; ` +
      `touch controls: ${touchControls?.root.dataset.state ?? 'not created'}`,
    `Page has focus: ${document.hasFocus() ? 'yes' : 'no'}; visible: ${document.visibilityState}`,
    `Controllers the browser reports now: ${st.pads.length || 'none (press a button on the controller while this page is open)'}`,
  ];
  for (const p of st.pads) {
    const pressed = p.buttons.map((b, i) => (b.pressed ? `${i}${b.value > 0 && b.value < 1 ? `=${b.value.toFixed(2)}` : ''}` : '')).filter(Boolean);
    lines.push(`#${p.index} "${p.id}"`,
      `   mapping "${p.mapping}", ${p.buttons.length} buttons, ${p.axes.length} axes${p === st.active ? '  <- handed to the game' : ''}`,
      `   raw axes ${p.axes.map(fmt).join(' ')}`, `   raw buttons pressed ${pressed.join(', ') || '-'}`);
  }
  if (st.virtual) {
    const v = st.virtual;
    const b = v.buttons.map((x) => x.value);
    lines.push('Handed to the game (standard layout after mapping):',
      `   ${STD_AXES.map((n, i) => `${n} ${fmt(v.axes[i])}`).join(', ')}`,
      `   buttons ${b.map((x, i) => (x > 0.1 ? STD_BUTTONS[i] : '')).filter(Boolean).join(', ') || '-'}`,
      `   expected actions: ${padActions(v.axes, b, loadPad().dead).join(', ') || '-'}`);
  }
  if (engine && session) {
    const e = engineSnapshot();
    const held = STD_BUTTONS.filter((_, i) => e.keys & (1 << i));
    lines.push(`Game: ${e.state}${e.multiplayer ? ', multiplayer' : ''}; controller ${e.open ? 'open' : 'NOT open'}; ` +
      `sticks held ${e.axes.map(fmt).join(' ')}; buttons held ${held.join(', ') || '-'}`);
    if (touchControls) {
      lines.push(`Touch: fingers ${touchControls.ownership().map((o) => o.button ?? o.kind).join(', ') || '-'}; ` +
        `keys ${touchControls.heldKeys.join(', ') || '-'}; turned ${touchControls.turned.yaw.toFixed(1)}° / ${touchControls.turned.pitch.toFixed(1)}°`);
    }
  }
  lines.push('Controller events (this page):', ...st.events.slice(-12).map((x) => `   ${x}`));
  if (!engine) {
    const last = lastTrace();
    lines.push('Last game session:', ...(last ? last.split('\n').map((x) => `   ${x}`) : ['   none recorded in this browser yet']));
  }
  return redact(lines.join('\n'));
}

function startLiveDiagnostics() {
  const el = $('diag-live');
  el.hidden = false;
  setInterval(() => { el.textContent = diagnosticsText(true); }, 250);
}

/** Records where controller input stops during this game session (app/diagnostics.ts). */
function startTrace() {
  const trace = new InputTrace();
  let n = 0;
  setInterval(() => {
    if (!session) return;
    const st = pads.status();
    const e = engineSnapshot();
    const v = st.virtual;
    trace.add({
      inGame: e.inGame, state: e.state, raw: st.pads.length > 0, handed: !!v,
      axes: v ? v.axes : [0, 0, 0, 0], buttons: v ? v.buttons.reduce((m, b, i) => m | (b.pressed ? 1 << i : 0), 0) : 0,
      engineOpen: e.open, engineAxes: e.axes, engineKeys: e.keys,
    });
    if (++n % 8 === 0) {
      trace.last = diagnosticsText(true);
      saveTrace(trace);
    }
  }, 250);
  const store = () => { trace.last = diagnosticsText(true); saveTrace(trace); };
  window.addEventListener('pagehide', store);
  document.addEventListener('visibilitychange', () => { if (document.hidden) store(); });
}

/** The startup page's controller calibration (input/calibrate.ts): sticks and buttons are detected as they are
 *  used; each step needs everything released first, so one press is not taken for two buttons. */
function startCalibration() {
  const st = pads.status();
  const pad = st.active ?? st.pads[0];
  if (!pad) return alert('No controller found yet: press a button on it, then try again.');
  const cal = new Calibration(pad);
  calibrating = cal;
  $('calib').hidden = false;
  let armed = false;
  const neutral = (p: RawPad) => !p.buttons.some((b) => b.pressed || b.value > 0.3) &&
    p.axes.every((v, i) => Math.abs(v - (cal.profile.centers[i] ?? 0)) < 0.3);
  const finish = (save: boolean) => {
    calibrating = null;
    $('calib').hidden = true;
    if (save) {
      pads.setProfile(pad.id, cal.profile);
      alert('Mapping saved for this controller.');
    }
  };
  const render = () => {
    $('calib-step').textContent = cal.step ? `Step ${cal.at + 1} of ${cal.steps.length}: ${cal.step.text}` : '';
    $('calib-next').hidden = cal.step?.kind !== 'center';
  };
  $('calib-next').onclick = () => { const p = pads.physical().find((x) => x.id === pad.id); if (p) cal.sample(p); armed = false; render(); };
  $('calib-skip').onclick = () => { cal.skip(); armed = false; if (cal.done) finish(true); else render(); };
  $('calib-cancel').onclick = () => finish(false);
  render();
  const tick = () => {
    if (calibrating !== cal) return;
    const p = pads.physical().find((x) => x.id === pad.id);
    if (p && cal.step && cal.step.kind !== 'center') {
      if (!armed) armed = neutral(p);
      else if (cal.sample(p)) { armed = false; render(); }
    }
    if (cal.done) return finish(true);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Multiplayer availability as the PC host reports it (nothing is invented when it does not). */
async function checkMultiplayer() {
  const out = $('mp-status');
  try {
    const res = await fetch(new URL('lan/status.json', document.baseURI), { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) throw new Error('none');
    const st = await res.json();
    const servers: string[] = Array.isArray(st?.multiplayer?.servers) ? st.multiplayer.servers.filter((s: unknown) => typeof s === 'string') : [];
    out.textContent = servers.length
      ? `Available through this PC: ${servers.map(sanitize).join(', ')}.`
      : 'Not available: this PC\'s LAN host runs without a game server (see the multiplayer guide).';
  } catch {
    out.textContent = 'Not available on this page: multiplayer needs the LAN host on your PC with a game server ' +
      '(see the multiplayer guide). Single-player is not affected.';
  }
}

function hostProblem(title: string, text: string, pair = false) {
  $('host-problem-title').textContent = title;
  $('host-problem-text').textContent = text;
  $('host-pair').hidden = !pair;
  $('host-problem').hidden = false;
  setStatus('bad', `Game data: ${title.toLowerCase()}`, 'See below.');
}

function remembered(key: string) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function remember(key: string) {
  try { localStorage.setItem(key, '1'); } catch { /* private mode */ }
}

/** Phones and tablets play from the installed app (app/install.ts); the browser page explains how to install it. */
function setupInstall() {
  const st = installState();
  document.body.classList.toggle('gated', st.gate);
  let skipped = false;
  try { skipped = sessionStorage.getItem('sof.installskip') === '1'; } catch { /* private mode */ }
  $('install-gate').hidden = !(st.gate || (st.offer && !skipped));
  $('install-gate').querySelector('h2')!.textContent = st.gate ? 'Install the app to play on this device'
    : 'Install the app (recommended)';
  $('install-skip').addEventListener('click', () => {
    try { sessionStorage.setItem('sof.installskip', '1'); } catch { /* private mode */ }
    $('install-gate').hidden = true;
  });
  $('install-ios').hidden = st.platform !== 'ios';
  $('install-android').hidden = st.platform !== 'android';
  watchInstallPrompt(() => { $('install-btn').hidden = false; });
  $('install-btn').addEventListener('click', async () => {
    const r = await promptInstall();
    $('install-btn').hidden = true;
    if (r === 'accepted') $('install-note').textContent = 'Installed: open Soldier of Fortune Web from its Home Screen icon to play.';
  });
  // the installed app's shell (app/sw.js); registration needs a secure context with a trusted certificate
  if (import.meta.env.PROD && 'serviceWorker' in navigator && isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch((err: Error) => {
      if (!st.gate && !st.offer) return;
      const note = $('cert-note');
      note.hidden = false;
      note.textContent = `This browser refused the app's service worker (${err.name}). If you accepted a certificate warning ` +
        'for this address, the PC\'s certificate is not trusted: install and trust it first (Help → Play on a phone), ' +
        'otherwise the installed app cannot open the page.';
    });
  }
}

/** The previous session's last moments, when it did not end normally (app/journal.ts). */
function showLastSession() {
  const prev = Journal.previousUnclean();
  // a session last seen in the background was most likely closed by the system: not a failure (unless it looked stuck)
  if (!prev || (!prev.trouble && /background/.test(prev.events[prev.events.length - 1]?.m ?? ''))) return;
  $('last-session').hidden = false;
  if (prev.ended && prev.trouble) $('last-session-title').textContent = 'The last game session looked stuck';
  $('last-session-text').textContent = `It stopped at ${new Date(prev.beatAt).toLocaleString()}: ${interpret(prev)}.`;
  const report = $('last-session-report');
  report.textContent = journalText(prev);
  $('last-session-copy').addEventListener('click', async () => {
    report.hidden = false;
    try {
      await navigator.clipboard.writeText(report.textContent ?? '');
      $('last-session-copy').textContent = 'Copied';
    } catch {
      const r = document.createRange();
      r.selectNodeContents(report);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
    }
  });
  $('last-session-dismiss').addEventListener('click', () => {
    $('last-session').hidden = true;
    try { localStorage.removeItem('sof.journal'); } catch { /* private mode */ }
  });
}

/** Versions of what runs: the page's script (its build hash), the engine files and the offline cache - and whether
 *  the cache holds this same page and engine (an installed app shows the cached version until an update completes). */
async function buildInfo(): Promise<string> {
  const page = /([^/?]+)\.js(\?|$)/.exec(import.meta.url)?.[1] ?? 'unknown';
  let cache = 'none';
  const ctl = 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;
  if (ctl) {
    const r = await new Promise<{ version: string; urls?: string[] } | null>((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => resolve(e.data);
      ctl.postMessage('version', [ch.port2]);
      setTimeout(() => resolve(null), 1500);
    });
    if (!r) cache = 'no answer';
    else if (!r.urls) cache = `${r.version} (older offline cache)`;
    else {
      const same = r.urls.some((u) => import.meta.url.endsWith(u)) && r.urls.some((u) => u.endsWith(`?v=${__ENGINE_VERSION__}`));
      cache = `${r.version} (${same ? 'same as this page' : 'DIFFERENT from this page: an update is being installed; reopen the app'})`;
    }
  }
  return `page ${page}, engine ${__ENGINE_VERSION__}, offline cache ${cache}`;
}

/** Browser settings: the last two sessions' reports, however they ended. */
function setupSessionReports() {
  const render = () => {
    const recs = Journal.recent();
    $('sessions').textContent = recs.length ? recs.map((r) => journalText(r)).join('\n\n') : 'No game session recorded yet.';
  };
  render();
  void buildInfo().then((b) => { $('build-info').textContent = b; });
  $('sessions-group').addEventListener('toggle', render);
  $('sessions-copy').addEventListener('click', async () => {
    render();
    try {
      await navigator.clipboard.writeText($('sessions').textContent ?? '');
      $('sessions-copied').textContent = 'Copied';
    } catch {
      const r = document.createRange();
      r.selectNodeContents($('sessions'));
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      $('sessions-copied').textContent = 'Selected: copy it with the system menu';
    }
  });
  $('sessions-forget').addEventListener('click', () => { Journal.forget(); render(); });
}

// ---- display settings (per device) -------------------------------------------------------------
function loadDisplay(): DisplaySettings {
  try {
    return parseDisplay(JSON.parse(localStorage.getItem('sof.display') ?? '{}'));
  } catch {
    return { ...DEFAULT_DISPLAY };
  }
}

function saveDisplay(v: DisplaySettings) {
  try { localStorage.setItem('sof.display', JSON.stringify(v)); } catch { /* private mode: keep defaults */ }
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
  $('reselect').addEventListener('click', () => {
    current = null;
    setStatus('idle', 'Game data: not selected', 'Choose your Soldier of Fortune folder below.');
    show('choose');
  });
  $('rotate-back').addEventListener('click', () => {
    // before the game starts: back to the page; during play: the game's own Quit, which stores settings and saves
    if (session) engineCmd('quit'); else { abort?.abort(); $('rotate').hidden = true; }
  });
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

  // touch settings: every control shows its value and is stored at once
  const touch = loadTouch();
  const fields: Array<[string, keyof TouchSettings, (v: number) => string]> = [
    ['touch-lookx', 'lookX', (v) => `${v.toFixed(2)}°`], ['touch-looky', 'lookY', (v) => `${v.toFixed(2)}°`],
    ['touch-aim', 'aimScale', (v) => `×${v.toFixed(2)}`], ['touch-scale', 'scale', (v) => `×${v.toFixed(2)}`],
    ['touch-opacity', 'opacity', (v) => `${Math.round(v * 100)}%`], ['touch-edgex', 'edgeX', (v) => `${v}px`],
    ['touch-edgey', 'edgeY', (v) => `${v}px`],
  ];
  const checks: Array<[string, keyof TouchSettings]> = [
    ['touch-invert', 'invertY'], ['touch-firelook', 'fireLook'], ['touch-leftfire', 'leftFire'], ['touch-left', 'leftHanded'],
  ];
  const showTouch = () => {
    $<HTMLSelectElement>('touch-mode').value = touch.mode;
    showAimUpdate();
    for (const [id, key, f] of fields) {
      const v = touch.settings[key] as number;
      $<HTMLInputElement>(id).value = String(v);
      document.querySelector<HTMLOutputElement>(`output[for="${id}"]`)!.value = f(v);
    }
    for (const [id, key] of checks) $<HTMLInputElement>(id).checked = touch.settings[key] as boolean;
  };
  const storeTouch = () => {
    touch.mode = $<HTMLSelectElement>('touch-mode').value as InputMode;
    const raw: Record<string, unknown> = {};
    for (const [id, key] of fields) raw[key] = Number($<HTMLInputElement>(id).value);
    for (const [id, key] of checks) raw[key] = $<HTMLInputElement>(id).checked;
    touch.settings = parseTouch(raw);
    touch.custom = migrateTouchLook(raw, SETTINGS_VERSION).custom;
    saveTouch(touch);
    showTouch();
  };
  for (const id of ['touch-mode', ...fields.map((f) => f[0]), ...checks.map((c) => c[0])]) $(id).addEventListener('input', storeTouch);
  $('touch-reset').addEventListener('click', () => {
    touch.mode = 'auto';
    touch.settings = { ...DEFAULT_TOUCH };
    touch.custom = [];
    saveTouch(touch);
    showTouch();
  });

  // controller settings, calibration and diagnostics
  const padState = loadPadState();
  const pad = padState.pad;
  let padCustom = padState.custom;
  pads.setChoice(pad.choice);
  // stored values from earlier versions that still equal the old defaults were moved to the new ones; values the
  // player chose stay, and the new recommendation is offered explicitly (Settings and the top of the page)
  const showAimUpdate = () => {
    const differs = touch.custom.length > 0 || padCustom.length > 0;
    let dismissed = false;
    try { dismissed = localStorage.getItem('sof.aimupdate') === String(SETTINGS_VERSION); } catch { /* private mode */ }
    $('aim-update').hidden = !differs || dismissed;
    $('aim-update-note').textContent = differs
      ? `Your own values are kept (${[...touch.custom.map((k) => `touch ${k}`), ...padCustom.map((k) => `controller ${k}`)].join(', ')}).` : '';
  };
  const padFields: Array<[string, 'yaw' | 'pitch' | 'dead', (v: number) => string]> = [
    ['pad-yaw', 'yaw', (v) => `${v}°/s`], ['pad-pitch', 'pitch', (v) => `${v}°/s`], ['pad-dead', 'dead', (v) => v.toFixed(2)],
  ];
  const choice = $<HTMLSelectElement>('pad-choice');
  const showPad = () => {
    for (const [id, key, f] of padFields) {
      $<HTMLInputElement>(id).value = String(pad[key]);
      document.querySelector<HTMLOutputElement>(`output[for="${id}"]`)!.value = f(pad[key]);
    }
    $<HTMLInputElement>('pad-invert').checked = pad.invertY;
    $<HTMLSelectElement>('pad-curve').value = pad.curve;
    $<HTMLInputElement>('pad-boost').checked = pad.boost;
    showAimUpdate();
  };
  const storePad = () => {
    for (const [id, key] of padFields) pad[key] = Number($<HTMLInputElement>(id).value);
    pad.invertY = $<HTMLInputElement>('pad-invert').checked;
    pad.curve = $<HTMLSelectElement>('pad-curve').value as Curve;
    pad.boost = $<HTMLInputElement>('pad-boost').checked;
    pad.choice = choice.value;
    padCustom = migratePad({ ...pad }, SETTINGS_VERSION).custom;
    pads.setChoice(pad.choice);
    savePad(pad);
    showPad();
  };
  for (const id of ['pad-yaw', 'pad-pitch', 'pad-dead', 'pad-invert', 'pad-curve', 'pad-boost', 'pad-choice']) $(id).addEventListener('input', storePad);
  const resetPad = () => { Object.assign(pad, PAD_DEFAULTS, { choice: pad.choice }); padCustom = []; savePad(pad); showPad(); };
  $('pad-reset').addEventListener('click', () => { resetPad(); choice.value = 'auto'; pads.setChoice('auto'); pad.choice = 'auto'; savePad(pad); });
  // "Apply updated recommended controls": look speeds, curve and dead zone of touch and controller to the new defaults
  $('aim-apply').addEventListener('click', () => {
    Object.assign(touch.settings, TOUCH_LOOK_DEFAULTS);
    touch.custom = [];
    saveTouch(touch);
    // speeds, dead zone, curve and boost only: inversion and the chosen controller stay
    const { yaw, pitch, dead, curve, boost } = PAD_DEFAULTS;
    Object.assign(pad, { yaw, pitch, dead, curve, boost });
    padCustom = [];
    savePad(pad);
    showPad();
    showTouch();
  });
  $('aim-keep').addEventListener('click', () => {
    try { localStorage.setItem('sof.aimupdate', String(SETTINGS_VERSION)); } catch { /* private mode */ }
    showAimUpdate();
  });
  showTouch();
  $('pad-calibrate').addEventListener('click', startCalibration);
  $('pad-reset-map').addEventListener('click', () => {
    const p = pads.status().active ?? pads.physical()[0];
    if (p) { pads.setProfile(p.id, null); alert('This controller uses its default mapping again.'); }
  });
  showPad();
  // the controller list and the diagnostics follow the browser while the page is shown
  let listed = '';
  const diag = $('diag');
  const diagGroup = $<HTMLDetailsElement>('diag-group');
  const diagIngame = $<HTMLInputElement>('diag-ingame');
  diagIngame.checked = diagWanted();
  diagIngame.addEventListener('input', () => {
    try { localStorage.setItem('sof.inputdiag', diagIngame.checked ? '1' : '0'); } catch { /* private mode */ }
  });
  setInterval(() => {
    if (state === 'running') return;
    const ids = pads.physical().map((p) => p.id);
    const key = ids.join('|');
    if (key !== listed) {
      listed = key;
      const keep = pad.choice;
      choice.replaceChildren(new Option('automatic (the one in use)', 'auto'),
        ...[...new Set([...ids, ...(keep !== 'auto' ? [keep] : [])])].map((id) => new Option(sanitize(id), id)));
      choice.value = keep;
    }
    if (diagGroup.open) diag.textContent = diagnosticsText();
  }, 200);

  const display = loadDisplay();
  const aspectSel = $<HTMLSelectElement>('display-aspect');
  const fpsSel = $<HTMLSelectElement>('display-fps');
  aspectSel.value = display.aspect;
  fpsSel.value = display.fps;
  const storeDisplay = () => saveDisplay(parseDisplay({ aspect: aspectSel.value, fps: fpsSel.value }));
  aspectSel.addEventListener('input', storeDisplay);
  fpsSel.addEventListener('input', storeDisplay);
  displayHz = measureRefresh();
  void displayHz.then((hz) => { $('display-hz').textContent = hz ? `This display: about ${hz} Hz.` : ''; });

  const devConsole = $<HTMLInputElement>('dev-console');
  devConsole.checked = consoleWanted();
  devConsole.addEventListener('input', () => {
    try { localStorage.setItem('sof.console', devConsole.checked ? '1' : '0'); } catch { /* private mode */ }
  });

  startGamepadNavigation(() => state !== 'running' && !calibrating);
  void refreshProfile();
  showLastSession();
  setupSessionReports();
  $('game-error-back').addEventListener('click', () => void leaveToStart('back to the start page after an error'));
  show('welcome');
  setupInstall();
  $('host-retry').addEventListener('click', () => void checkHostedData());
  $('diag-copy').addEventListener('click', async () => {
    const text = diagnosticsText();
    try {
      await navigator.clipboard.writeText(text);
      $('diag-copied').textContent = 'Copied (access keys removed).';
    } catch {
      // no clipboard access: select the report so it can be copied by hand
      const r = document.createRange();
      r.selectNodeContents($('diag'));
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      $('diag-copied').textContent = 'Selected: copy it with the system menu.';
    }
  });
  void startDataSources();
  void checkMultiplayer();
}

init();
