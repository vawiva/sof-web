// Shared description of an on-device game installation (origin-private file system, OPFS).
//
// Layout under the OPFS root:
//   sof-game/<archive>        the game archives, written in bounded pieces by the install worker
//   sof-game/progress.json    while installing: which archives are complete and verified (for resuming)
//   sof-game/install.json     written last, only after every archive was read back and verified: its presence is
//                             what makes the installation playable (an interrupted install never has it)
// Saves and settings are not here: they stay in IndexedDB (/sof/user), so removing the game data keeps them.

export const INSTALL_DIR = 'sof-game';
export const MANIFEST = 'install.json';
export const PROGRESS = 'progress.json';
export const FORMAT = 1;

export type InstallSourceKind = 'files' | 'lan' | 'disc-image' | 'gog-installer';

export interface InstalledFile {
  name: string;
  size: number;
  /** MD5 of the stored bytes, from reading them back after writing (checked again by "Verify") */
  md5: string;
}

export interface InstallManifest {
  format: number;
  game: 'sof1';
  editionId: string | null;
  editionLabel: string;
  source: InstallSourceKind;
  installedAt: string;
  files: InstalledFile[];
}

export interface InstallProgressFile {
  format: number;
  source: InstallSourceKind;
  /** archives completely written and verified */
  done: InstalledFile[];
}

/** One archive to install: its canonical name and expected size. */
export interface WantedFile {
  name: string;
  size: number;
}

export type InstallSource =
  | { kind: 'files'; files: Record<string, File> }
  | { kind: 'lan'; urls: Record<string, string> }
  | { kind: 'disc-image'; file: File; /** canonical name -> path inside the installer cabinet */ paths: Record<string, string> }
  | { kind: 'gog-installer'; file: File; /** canonical name -> target path inside the installer */ paths: Record<string, string> };

export type ToWorker =
  | { op: 'install'; source: InstallSource; files: WantedFile[] }
  | { op: 'commit'; manifest: InstallManifest }
  | { op: 'verify' }
  | { op: 'cancel' };

export type FromWorker =
  | { op: 'progress'; phase: 'copy' | 'verify'; file: string; done: number; total: number }
  | { op: 'installed'; files: InstalledFile[] }
  | { op: 'committed' }
  | { op: 'verified'; ok: boolean; problems: string[] }
  | { op: 'error'; code: 'cancelled' | 'quota' | 'source' | 'storage' | 'unsupported'; message: string };

export function isManifest(m: unknown): m is InstallManifest {
  const o = m as InstallManifest;
  return !!o && o.format === FORMAT && o.game === 'sof1' && Array.isArray(o.files) &&
    o.files.every((f) => typeof f?.name === 'string' && Number.isSafeInteger(f.size) && typeof f.md5 === 'string');
}
