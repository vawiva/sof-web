// Controller navigation for the browser pages around the game (startup, settings, errors).
// While the game runs, the engine reads the controller itself, so this stays inactive.

const FOCUSABLE = 'button:not([hidden]):not(:disabled), .button, select, input[type=checkbox], input[type=range], summary';

export function startGamepadNavigation(active: () => boolean) {
  let last = new Map<number, boolean>();
  let lastMove = 0;
  const tick = () => {
    requestAnimationFrame(tick);
    if (!active()) return;
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.mapping === 'standard' && p.connected);
    if (!pad) return;
    const pressed = (i: number) => !!pad.buttons[i]?.pressed;
    const edge = (i: number) => pressed(i) && !last.get(i);
    const now = performance.now();
    const y = pad.axes[1] ?? 0;
    const x = pad.axes[0] ?? 0;
    let dir = 0;
    if (pressed(12) || y < -0.6 || pressed(14) || x < -0.6) dir = -1;
    if (pressed(13) || y > 0.6 || pressed(15) || x > 0.6) dir = 1;
    if (dir && now - lastMove > 220) {
      lastMove = now;
      const items = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      const i = items.indexOf(document.activeElement as HTMLElement);
      const target = items[(i + dir + items.length) % items.length] ?? items[0];
      if (target instanceof HTMLInputElement && target.type === 'range' && document.activeElement === target && (pressed(14) || pressed(15))) {
        target.stepUp(dir);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      } else target?.focus();
    }
    if (edge(0)) (document.activeElement as HTMLElement | null)?.click(); // A / Cross
    if (edge(1)) document.querySelector<HTMLElement>('#retry:not([hidden]), #reselect, #cancel')?.click(); // B / Circle
    last = new Map(pad.buttons.map((b, i) => [i, b.pressed]));
  };
  requestAnimationFrame(tick);
}
