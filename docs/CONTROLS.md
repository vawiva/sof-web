# Controls

All three input modes drive the same engine commands. Keyboard and mouse use the game's own defaults: the game's
`default.cfg` runs `configs/default_keys.cfg` and `default_misc.cfg` from the player's own archives (openMERC's data
archive with its "modern layout" is not loaded). The page only adds controller button bindings on the first start.

| Action | Keyboard / mouse (game default) | Controller (standard mapping) | Touch |
| --- | --- | --- | --- |
| Move / strafe | W A S D, arrows, `,` `.` | left stick (analog) | left side: drag (8-way, like the keyboard) |
| Run | Shift (hold) | left stick press (hold) | push the stick to its edge |
| Look | mouse (pointer lock after clicking the game) | right stick | right side: drag |
| Fire / alternate fire | left mouse, Ctrl / middle mouse, M | right / left trigger | Fire / Alt |
| Jump / crouch | E, `/` / C, L | A / B (hold) | Jump / Crouch (hold) |
| Use / open | Space | X | Use |
| Reload | R | Y | Reload |
| Next / previous weapon | wheel, O / I | right / left shoulder | Weap ▶ / ◀ Weap |
| Select weapon 1–12 | 1–0, `-`, `=` | (cycle with shoulders) | (cycle) |
| Lean left / right | F / G | d-pad left / right (hold) | Lean ◀ / Lean ▶ (hold) |
| Next / previous item, use item | `]` X / `[` Z, Enter | d-pad up / down, right stick press | Item ▶, Item |
| Objectives | Tab | Back / Select | Obj (hold) |
| Game menu / pause | Esc | Start | Menu |
| Quick save / load | F6 / F7 | via game menu | via game menu |
| Menus (original pages) | mouse pointer, Esc = back | d-pad up/down = next/previous item, shoulders = tabs and page buttons, d-pad left/right = change value, A = select, B = back | touch where you want to click; drag sliders; Menu = back |

Notes and limits:

- Verification: keyboard/mouse and touch are browser-tested with the real game; controller buttons and triggers were
  tested with a scripted gamepad only and the **analog sticks are not verified**.
- Controller buttons are written once into the profile's config on first start; afterwards the game's own key menu
  changes them. Stick dead zones are engine settings (`joy_left_deadzone`, `joy_right_deadzone`, default 0.16 here).
- The original menus are mouse-driven. In the browser the game's cursor follows the pointer in the menus; the mouse is
  captured only during play (click the game once to capture it). Controller navigation of the original menus
  (openMERC's `menu_gamepad`) is browser-tested with a scripted controller (main menu → Game page with A, back with
  B); the startup page also supports the d-pad/stick, A and B.
- The browser's file dialog may need a mouse, keyboard or touch.
- Touch controls appear only on touch screens (or when set to "always" on the startup page) and hide as soon as a
  keyboard, mouse or controller is used. While one of the game's menus is open, only the Menu (back) button stays and
  a touch is the menu pointer. The button grids sit in the black side bars beside the 4:3 picture as far as those are
  wide enough; on an 844x390 phone-shaped view the left grid fits and the right grid overlaps the picture's right edge
  by one column. A touch in a menu first moves the game's cursor and presses a moment later, because the original
  menus click the item under the cursor of the previous frame. Size, opacity, look speed, inversion and a
  left-handed layout are configurable on the startup page; every button is at least 44 CSS px at default size.
- Weapon slots 1–12, item quick keys (numpad) and wave gestures have no dedicated controller/touch button yet;
  cycling covers weapon and item selection.
