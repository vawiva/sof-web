// What a playable Soldier of Fortune installation must contain. Only non-sensitive facts are
// listed (archive names, entry counts, sizes, entry names) - no game data.

export interface PakSignature {
  file: string;
  entries: number;
  size: number;
}

export interface Edition {
  id: string;
  label: string;
  paks: PakSignature[];
}

export const GAME = {
  id: 'sof1',
  title: 'Soldier of Fortune',
  year: 2000,
  developer: 'Raven Software',
} as const;

/** Archives the engine loads, in Quake II search order. */
export const REQUIRED_PAKS = ['pak0.pak', 'pak1.pak', 'pak2.pak', 'pak3.pak', 'gs.pak'] as const;

/** Editions whose archives were checked against a real installation. */
export const KNOWN_EDITIONS: Edition[] = [
  {
    id: 'gog-platinum-1.07f',
    label: 'Platinum Edition 1.07f (GOG, English)',
    paks: [
      { file: 'pak0.pak', entries: 9728, size: 705825784 },
      { file: 'pak1.pak', entries: 533, size: 20517183 },
      { file: 'pak2.pak', entries: 499, size: 48985072 },
      { file: 'pak3.pak', entries: 14, size: 9406518 },
      { file: 'gs.pak', entries: 39, size: 205126 },
    ],
  },
  {
    // the 2001 Platinum CD (InstallShield set): same game module as GOG 1.07f; pak0.pak differs from GOG's only in
    // menus/b_lock.rmf (the parental-lock button, which GOG emptied); pak1-3 and gs.pak are identical
    id: 'cd-platinum-1.07f',
    label: 'Platinum Edition 1.07f (2001 CD, English)',
    paks: [
      { file: 'pak0.pak', entries: 9728, size: 705825871 },
      { file: 'pak1.pak', entries: 533, size: 20517183 },
      { file: 'pak2.pak', entries: 499, size: 48985072 },
      { file: 'pak3.pak', entries: 14, size: 9406518 },
      { file: 'gs.pak', entries: 39, size: 205126 },
    ],
  },
];

/** Entries the single-player campaign cannot start without (checked across all archives). */
export const REQUIRED_ENTRIES = [
  'default.cfg',
  'configs/default_keys.cfg',
  'maps/tut1.bsp',
  ...['tsr1', 'tsr2', 'trn1', 'arm1', 'kos1', 'kos2', 'kos3', 'sib1', 'sib2', 'sib3', 'irq1a', 'irq2a',
    'irq3a', 'arm2', 'nyc1', 'nyc2', 'nyc3', 'sud1', 'sud2', 'sud3', 'arm3', 'jpn1', 'jpn2', 'jpn3',
    'irq1b', 'irq2b', 'irq3b', 'ger1', 'ger2', 'ger3', 'ger4'].map((m) => `maps/${m}.bsp`),
];

/** Formats people commonly have that this port cannot use, with a precise explanation. */
export const UNSUPPORTED_HINTS: Array<{ test: RegExp; message: string }> = [
  { test: /\.iso$/i, message: 'The 2001 Platinum CD image (.iso) can be imported under "Keep the game on this device"; it is not played directly.' },
  { test: /\.(bin|cue|img|mdf|mds|nrg)$/i, message: 'This disc-image format is not read. Use an .iso of the 2001 Platinum CD (under "Keep the game on this device"), or the installed "base" folder.' },
  { test: /\.(exe|msi)$/i, message: 'Installers are not run or unpacked in the browser. Select the installed "base" folder (or import the 2001 CD image).' },
  { test: /\.(zip|7z|rar)$/i, message: 'Archives are not unpacked here. Extract them first and select the "base" folder.' },
];
