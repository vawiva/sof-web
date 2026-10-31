// Aiming defaults for touch and controller, and the migration of stored settings.
//
// The defaults are this project's own approximation of a responsive mobile shooter, measured in this game
// (work/tools/pw/aim-measure.mjs; docs/CONTROLS.md lists the numbers). They are NOT HCE Mobile's values: its public
// input script hands touch movement (finger travel x sensitivity x 2) and raw sticks to the Halo engine, whose
// conversion to degrees is not visible there, so its turn rates cannot be copied.
//
// Stored settings carry a version. Version 1 (round 8) defaults were slow; a stored value that still equals a
// version-1 default is taken as "never chosen" and moves to the new default, while values the player changed are kept
// and the page offers to apply the new recommendation explicitly.

/** Controller response curve: exponent applied to the stick deflection beyond the dead zone. */
export const CURVES = { linear: 1.0, balanced: 1.5, precise: 2.0 } as const;
export type Curve = keyof typeof CURVES;

export interface PadSettings {
  choice: string;
  yaw: number;       // degrees per second at full deflection, horizontal
  pitch: number;     // vertical
  dead: number;      // stick dead zone, 0..0.5
  invertY: boolean;
  curve: Curve;
  boost: boolean;    // extra horizontal speed while the stick is held at its edge (openMERC's ramp), off by default
}

export const PAD_DEFAULTS: PadSettings = { choice: 'auto', yaw: 330, pitch: 220, dead: 0.12, invertY: false, curve: 'balanced', boost: false };
export const TOUCH_LOOK_DEFAULTS = { lookX: 0.45, lookY: 0.35 };
export const SETTINGS_VERSION = 2;

/** Version-1 defaults (stored by round 8 builds whenever any setting was saved). */
const V1_TOUCH = { lookX: 0.3, lookY: 0.25 };
const V1_PAD = { yaw: 160, pitch: 120, dead: 0.16 };

const num = (v: unknown, lo: number, hi: number, d: number) =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function parsePad(raw: Record<string, unknown> | null | undefined): PadSettings {
  const r = raw ?? {};
  const d = PAD_DEFAULTS;
  return {
    choice: typeof r.choice === 'string' ? r.choice : d.choice,
    yaw: num(r.yaw, 30, 720, d.yaw), pitch: num(r.pitch, 30, 720, d.pitch), dead: num(r.dead, 0, 0.5, d.dead),
    invertY: r.invertY === true,
    curve: typeof r.curve === 'string' && r.curve in CURVES ? r.curve as Curve : d.curve,
    boost: r.boost === true,
  };
}

export interface Migrated<T> {
  value: T;
  /** values the player chose that differ from the current recommendation (kept; an explicit "apply" is offered) */
  custom: string[];
}

/** Brings stored touch look values to the current version (the rest of the touch settings is unaffected). */
export function migrateTouchLook(raw: Record<string, unknown>, version: number): Migrated<Record<string, unknown>> {
  const out = { ...raw };
  if (version < SETTINGS_VERSION) {
    for (const k of ['lookX', 'lookY'] as const) if (out[k] === undefined || out[k] === V1_TOUCH[k]) delete out[k];
  }
  const custom = (['lookX', 'lookY'] as const).filter((k) => typeof out[k] === 'number' && out[k] !== TOUCH_LOOK_DEFAULTS[k]);
  return { value: out, custom };
}

export function migratePad(raw: Record<string, unknown>, version: number): Migrated<PadSettings> {
  const out = { ...raw };
  if (version < SETTINGS_VERSION) {
    for (const k of ['yaw', 'pitch', 'dead'] as const) if (out[k] === V1_PAD[k]) delete out[k];
  }
  const value = parsePad(out);
  const custom = (['yaw', 'pitch', 'dead', 'curve', 'boost'] as const).filter((k) => out[k] !== undefined && value[k] !== PAD_DEFAULTS[k]);
  return { value, custom };
}

/** The engine variables for the controller settings (openMERC's joy_* cvars; no hidden extra speed unless chosen). */
export function padCvars(p: PadSettings): string {
  return [
    `set joy_yawspeed ${p.yaw}`, `set joy_pitchspeed ${p.invertY ? -p.pitch : p.pitch}`,
    `set joy_left_deadzone ${p.dead}`, `set joy_right_deadzone ${p.dead}`,
    `set joy_right_expo ${CURVES[p.curve]}`,
    `set joy_extra_yawspeed ${p.boost ? 220 : 0}`, 'set joy_extra_pitchspeed 0',
  ].join('; ');
}
