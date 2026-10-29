// Original Soldier of Fortune presentation on the openMERC engine.
//
// openMERC ships its own menu pages, fonts and a widescreen menu layout. The browser port does not load that
// data archive, so the game's own menu pages, fonts and scripts from the player's archives are used, and
// these engine settings turn openMERC's layout options back to the original 640x480 composition. They are
// passed as +set on every start: the engine applies them again after the player's config.cfg, so profiles
// saved by older builds cannot bring the modern layout back.

/** gl_mode values of the original video page (Quake II numbering, all 4:3). */
export const SOF_MODES: ReadonlyArray<readonly [number, number]> = [
  [320, 240], [400, 300], [512, 384], [640, 480], [800, 600], [960, 720],
  [1024, 768], [1152, 864], [1280, 960], [1600, 1200], [2048, 1536],
];
/** The resolutions the original video page offers (gl_mode 3-9). */
const MENU_MODES = [3, 4, 5, 6, 7, 8, 9];

/** The largest mode of the original video page that fits a box of device pixels (at least 640x480). */
export function bestMode(width: number, height: number): number {
  let best = 3;
  for (const m of MENU_MODES) if (SOF_MODES[m][0] <= width && SOF_MODES[m][1] <= height) best = m;
  return best;
}

/** The gl_mode saved in a config.cfg, or null. */
export function savedMode(configText: string | null): number | null {
  const m = configText?.match(/^\s*set\s+gl_mode\s+"?(-?\d+)"?/m);
  return m ? Number(m[1]) : null;
}

export interface PresentationOptions {
  /** the player's config.cfg, or null on the first start */
  configText: string | null;
  /** the letterboxed 4:3 box the game is shown in, in device pixels */
  box: { width: number; height: number };
  /** the original's console key (off by default, as in the original) */
  console: boolean;
  /** touch sessions never capture the mouse (pointer lock freezes touch coordinates) */
  touch: boolean;
}

/** Engine command-line arguments; the default start (disclaimer, intro, main menu) runs last. */
export function presentationArgs(o: PresentationOptions): string[] {
  const set = (name: string, value: string | number) => ['+set', name, String(value)];
  const args = [
    // the page letterboxes the 640x480 composition; the engine never switches the browser to fullscreen
    ...set('vid_fullscreen', 0),
    ...set('menu_nofullscreen', 1), // the original's own switch that hides the video page's fullscreen row
    ...set('menu_notruecolour', 1), // and its colour-depth row (WebGL has one fixed depth)
    // openMERC layout options back to the original composition
    ...set('menu_layout', 0), // no widescreen tab layout drawn by code
    ...set('menu_rail', 0), // no side panel
    ...set('menu_dialogdim', 0), // dialogs over the undimmed page
    ...set('scr_aspect', 1), // 640x480 canvas (the window is 4:3, so this equals the original's width scale)
    ...set('ui_scale', 100), // capped to the exact fit: menus fill the 4:3 window like the original
    ...set('scr_hudscale', 0), // HUD at its 640x480 proportions at every resolution
    ...set('scr_textscale', 1),
    ...set('console', o.console ? 1 : 0),
    ...set('om_autosave_interval', 0), // no openMERC timed autosaves in the original load list
    ...(o.touch ? set('in_grab', 0) : []),
  ];
  const mode = savedMode(o.configText);
  if (mode === null || mode < 0 || mode >= SOF_MODES.length) {
    // first start (the original's default is 640x480 for 1999 hardware), or a mode from an older build
    const m = bestMode(o.box.width, o.box.height);
    args.push(...set('gl_mode', m));
  }
  return args;
}
