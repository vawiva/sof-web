// Controller calibration and remapping: the player moves each stick and presses each button when asked; the
// physical input that changed most becomes that function. Detection is kept separate from the page so it can be
// tested with recorded controller states.

import { type PadProfile, type RawPad, type Source, STD_AXES, STD_BUTTONS, defaultProfile } from './gamepad';

export type Step =
  | { kind: 'center'; text: string }
  | { kind: 'axis'; axis: number; text: string }
  | { kind: 'button'; button: number; text: string };

/** The questions, in order: rest position, the four stick directions, then every standard button. */
export function calibrationSteps(): Step[] {
  return [
    { kind: 'center', text: 'Let go of both sticks and all buttons, then choose Next.' },
    { kind: 'axis', axis: 0, text: 'Push the LEFT stick fully to the RIGHT and hold it.' },
    { kind: 'axis', axis: 1, text: 'Push the LEFT stick fully DOWN and hold it.' },
    { kind: 'axis', axis: 2, text: 'Push the RIGHT stick fully to the RIGHT and hold it.' },
    { kind: 'axis', axis: 3, text: 'Push the RIGHT stick fully DOWN and hold it.' },
    ...STD_BUTTONS.map((name, button) => ({ kind: 'button' as const, button, text: `Press ${name} (or Skip if it has none).` })),
  ];
}

/** The physical axis that moved furthest from its rest value (at least 0.5), with the direction it moved. */
export function detectAxis(centers: number[], pad: Pick<RawPad, 'axes'>, exclude: number[] = []) {
  let best = -1;
  let delta = 0;
  pad.axes.forEach((v, i) => {
    const d = v - (centers[i] ?? 0);
    if (!exclude.includes(i) && Math.abs(d) > Math.abs(delta)) { best = i; delta = d; }
  });
  return best >= 0 && Math.abs(delta) >= 0.5 ? { a: best, invert: delta < 0 } : null;
}

/** A pressed button, else an axis pushed past 0.6 from rest that the sticks do not use (d-pad hats, triggers). */
export function detectButton(centers: number[], pad: Pick<RawPad, 'axes' | 'buttons'>, stickAxes: number[]): Source {
  const b = pad.buttons.findIndex((x) => x.pressed || x.value > 0.5);
  if (b >= 0) return { b };
  const axis = detectAxis(centers, pad, stickAxes);
  if (!axis) return null;
  const d = (pad.axes[axis.a] ?? 0) - (centers[axis.a] ?? 0);
  return Math.abs(d) >= 0.6 ? { a: axis.a, dir: d > 0 ? 1 : -1 } : null;
}

/** Runs the steps against a controller; the page calls sample() when the player confirms a step. */
export class Calibration {
  readonly steps = calibrationSteps();
  at = 0;
  readonly profile: PadProfile;

  constructor(pad: RawPad) {
    this.profile = defaultProfile(pad);
    this.profile.buttons = STD_BUTTONS.map(() => null);
    this.profile.axes = STD_AXES.map(() => null);
  }

  get step(): Step | undefined { return this.steps[this.at]; }
  get done() { return this.at >= this.steps.length; }

  /** Reads the current step from the controller. Returns false (and stays) when nothing was detected. */
  sample(pad: RawPad): boolean {
    const s = this.step;
    if (!s) return false;
    if (s.kind === 'center') {
      // the true resting values: sticks near 0, but analog triggers on axes rest at -1 on many controllers
      this.profile.centers = [...pad.axes];
    } else if (s.kind === 'axis') {
      const used = this.profile.axes.filter((m): m is { a: number; invert: boolean } => !!m).map((m) => m.a);
      const m = detectAxis(this.profile.centers, pad, used);
      if (!m) return false;
      this.profile.axes[s.axis] = m;
    } else {
      const sticks = this.profile.axes.filter((m): m is { a: number; invert: boolean } => !!m).map((m) => m.a);
      const src = detectButton(this.profile.centers, pad, sticks);
      if (!src) return false;
      this.profile.buttons[s.button] = src;
    }
    this.at++;
    return true;
  }

  skip() { this.at++; }
}
