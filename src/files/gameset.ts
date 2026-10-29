// Builds a case-insensitive view of the files the player selected. Windows installs can use any
// capitalization ("Base/PAK0.PAK"); the engine expects canonical lower-case names. Files whose
// names collide once case is ignored are reported instead of silently picking one.

export interface SelectedFile {
  /** Path relative to the selection root, '/'-separated (webkitRelativePath or drag/drop path). */
  path: string;
  file: File;
}

export interface GameSet {
  /** canonical lower-case file name inside base/ -> the selected file */
  base: Map<string, SelectedFile>;
  /** selected files that were ignored, for the summary */
  ignored: number;
}

export interface GameSetProblem {
  kind: 'unsafe-path' | 'ambiguous';
  message: string;
  paths: string[];
}

export function normalizePath(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..') || /^[a-zA-Z]:$/.test(parts[0] ?? '') || path.startsWith('/')) {
    return null;
  }
  return parts.join('/');
}

/**
 * Picks the files of the game's base directory: either files inside a folder named "base" (any
 * case, at any depth of the selection) or loose files selected directly.
 */
export function buildGameSet(selected: SelectedFile[], wanted: (name: string) => boolean):
  { set: GameSet; problems: GameSetProblem[] } {
  const problems: GameSetProblem[] = [];
  const candidates = new Map<string, SelectedFile[]>();
  let ignored = 0;

  for (const s of selected) {
    const norm = normalizePath(s.path || s.file.name);
    if (norm === null) {
      problems.push({ kind: 'unsafe-path', message: 'A selected path is absolute or leaves the selected folder.', paths: [s.path] });
      continue;
    }
    const parts = norm.split('/');
    const name = parts[parts.length - 1].toLowerCase();
    const parent = parts.length > 1 ? parts[parts.length - 2].toLowerCase() : null;
    // inside base/, or a loose file chosen on its own
    if (!wanted(name) || (parent !== null && parent !== 'base')) {
      ignored++;
      continue;
    }
    const list = candidates.get(name) ?? [];
    list.push({ path: norm, file: s.file });
    candidates.set(name, list);
  }

  const base = new Map<string, SelectedFile>();
  for (const [name, list] of candidates) {
    if (list.length > 1) {
      problems.push({
        kind: 'ambiguous',
        message: `"${name}" was found more than once (names are compared without regard to case). Select only one game installation.`,
        paths: list.map((l) => l.path),
      });
      continue;
    }
    base.set(name, list[0]);
  }
  return { set: { base, ignored }, problems };
}
