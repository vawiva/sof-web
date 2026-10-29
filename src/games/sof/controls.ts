// Browser-side control defaults for Soldier of Fortune.
//
// Keyboard and mouse use the game's own defaults (configs/DEFAULT_KEYS.cfg in the player's data).
// The engine reads standard-mapping gamepads itself (left stick moves, right stick looks, with
// dead zones); only its buttons need bindings, which the original game never shipped. They are
// written to a first-run config so the in-game key menu can change them later.

/** Engine key names: JOY1-4 = face buttons, AUX5+ = the rest (SDL order), AUX29-32 = d-pad. */
export const GAMEPAD_BINDS: Array<[key: string, command: string, label: string]> = [
  ['AUX24', '+attack', 'Right trigger: fire'],
  ['AUX23', '+altattack', 'Left trigger: alternate fire'],
  ['JOY1', '+moveup', 'A / Cross: jump'],
  ['JOY2', '+movedown', 'B / Circle: crouch (hold)'],
  ['JOY3', '+use', 'X / Square: use / open'],
  ['JOY4', 'reload', 'Y / Triangle: reload'],
  ['AUX11', 'weapnext', 'Right shoulder: next weapon'],
  ['AUX10', 'weapprev', 'Left shoulder: previous weapon'],
  ['AUX8', '+speed', 'Left stick press: run (hold)'],
  ['AUX9', 'itemuse', 'Right stick press: use selected item'],
  ['AUX29', 'itemnext', 'D-pad up: next item'],
  ['AUX31', 'itemprev', 'D-pad down: previous item'],
  ['AUX32', '+leanleft', 'D-pad left: lean left (hold)'],
  ['AUX30', '+leanright', 'D-pad right: lean right (hold)'],
  ['AUX5', 'menu objectives', 'Back / Select: objectives'],
];

/**
 * Written once, on the first start of a profile; later starts keep the player's own config. The keyboard
 * and mouse defaults are the game's own (its default.cfg runs configs/default_keys.cfg from the player's
 * archives); only the controller buttons, which the original never bound, are added.
 */
export function firstRunConfig(): string {
  const lines = ["// written by the browser port on first start; edit bindings in the game's key menu"];
  for (const [key, cmd] of GAMEPAD_BINDS) lines.push(`bind ${key} "${cmd}"`);
  lines.push('set joy_left_deadzone 0.16', 'set joy_right_deadzone 0.16');
  return lines.join('\n') + '\n';
}

/** Keyboard/mouse help shown before launch (the game's DEFAULT_KEYS.cfg). */
export const KEYBOARD_HELP: Array<[string, string]> = [
  ['W A S D / arrow keys', 'move and strafe'],
  ['Mouse', 'look (click the game to capture the mouse)'],
  ['Left mouse / Ctrl', 'fire'],
  ['Middle mouse / M', 'alternate fire'],
  ['Right mouse', 'move forward (original default)'],
  ['E or /', 'jump'],
  ['C or L', 'crouch'],
  ['Shift', 'run'],
  ['Space', 'use / open'],
  ['F / G', 'lean left / right'],
  ['R', 'reload'],
  ['1-0, -, =', 'select weapon; mouse wheel cycles'],
  ['[ ] or Z X', 'previous / next item; Enter uses it'],
  ['Tab', 'objectives'],
  ['F6 / F7', 'quick save / quick load'],
  ['Esc', 'game menu'],
];
