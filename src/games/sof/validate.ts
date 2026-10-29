import { blobSource, PakError, readPakDirectory, type ByteSource } from '../../files/pak';
import type { GameSet } from '../../files/gameset';
import { KNOWN_EDITIONS, REQUIRED_ENTRIES, REQUIRED_PAKS, type Edition } from './manifest';

export interface PakReport {
  file: string;
  size: number;
  entries: number;
}

export type Validation =
  | { status: 'ok'; edition: Edition; paks: PakReport[] }
  | { status: 'unverified'; paks: PakReport[]; differences: string[] }
  | { status: 'error'; problems: string[] };

/** Opens a selected file for validation; tests substitute in-memory sources. */
export type SourceFor = (name: string) => ByteSource;

export async function validateGameSet(set: GameSet, signal?: AbortSignal,
  sourceFor: SourceFor = (name) => blobSource(set.base.get(name)!.file)): Promise<Validation> {
  return validatePaks((name) => set.base.has(name), sourceFor, signal,
    'Select the game\'s "base" folder (or the whole installation folder).');
}

/** Validates the archives available under their canonical names, wherever they come from. */
export async function validatePaks(has: (name: string) => boolean, sourceFor: SourceFor, signal?: AbortSignal,
  missingHint = ''): Promise<Validation> {
  const problems: string[] = [];
  const missing = REQUIRED_PAKS.filter((p) => !has(p));
  if (missing.length) {
    problems.push(`Missing required archive${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` +
      (missingHint ? ` ${missingHint}` : ''));
  }

  const paks: PakReport[] = [];
  const names = new Set<string>();
  for (const file of REQUIRED_PAKS) {
    if (!has(file)) continue;
    signal?.throwIfAborted();
    try {
      const src = sourceFor(file);
      const dir = await readPakDirectory(src);
      paks.push({ file, size: src.size, entries: dir.entries.length });
      for (const e of dir.entries) names.add(e.name.replace(/\\/g, '/').toLowerCase());
    } catch (err) {
      if (err instanceof PakError) problems.push(`${file}: ${err.message}.`);
      else throw err;
    }
  }
  if (problems.length) return { status: 'error', problems };

  const absent = REQUIRED_ENTRIES.filter((e) => !names.has(e));
  if (absent.length) {
    return {
      status: 'error',
      problems: [`The archives do not contain the single-player campaign (${absent.length} required file` +
        `${absent.length > 1 ? 's' : ''} missing, e.g. ${absent.slice(0, 3).join(', ')}). ` +
        'Demo versions and multiplayer-only installs are not supported.'],
    };
  }

  for (const ed of KNOWN_EDITIONS) {
    if (ed.paks.every((sig) => paks.some((p) => p.file === sig.file && p.size === sig.size && p.entries === sig.entries))) {
      return { status: 'ok', edition: ed, paks };
    }
  }
  const ref = KNOWN_EDITIONS[0];
  const differences = paks.flatMap((p) => {
    const sig = ref.paks.find((s) => s.file === p.file);
    return sig && (sig.size !== p.size || sig.entries !== p.entries)
      ? [`${p.file}: ${p.entries} entries / ${p.size} bytes (tested: ${sig.entries} / ${sig.size})`]
      : [];
  });
  return { status: 'unverified', paks, differences };
}
