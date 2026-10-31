# Controls

All input modes drive the same engine commands. Keyboard and mouse use the game's own defaults: the game's
`default.cfg` runs `configs/default_keys.cfg` and `default_misc.cfg` from the player's own archives (openMERC's data
archive with its "modern layout" is not loaded). The page only adds controller button bindings on the first start.

| Action | Keyboard / mouse (game default) | Controller (standard layout) | Touch |
| --- | --- | --- | --- |
| Move / strafe | W A S D, arrows, `,` `.` | left stick (analog) | left thumb: drag anywhere on the left side (analog) |
| Run | Shift (hold) | left stick press (hold) | push the stick to its edge |
| Look | mouse (pointer lock after clicking the game) | right stick (turn rate) | right side: drag (relative, direct) |
| Fire / alternate fire | left mouse, Ctrl / middle mouse, M | right / left trigger | Fire (drag it to aim) / Alt; optional second Fire on the left |
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
| Menus (original pages) | mouse pointer, Esc = back | d-pad / left stick = items, A = select, B = back | touch the item directly; Menu = back |

## Input modes (startup page → Settings → Controls)

- **Automatic** (default): touch controls while the screen is touched; a real keyboard key or real mouse movement
  hides them. A controller hides them only when its input is seen **arriving in the game** (a button press or a stick
  pushed past half way – idle drift does not count – while the game has the controller open and holds that button or
  stick); a controller that is connected but whose input does not reach the game leaves the touch controls in place.
  Within 3 s of controller input a touch does not bring them back (a thumb brushing the screen); after that a touch
  does. When the controller disconnects, held inputs are released and the touch controls return. Synthetic events (the
  overlay's own keys and pointer, mouse events a browser derives from touches) never switch modes.
- **Touch**: the touch controls are always shown. **Controller**: no touch controls during play; a touch in play does
  nothing (it is not passed to the game as a mouse click, which would fire), touches still work in the menus.
  **Keyboard and mouse**: no touch overlay at all.

## Touch

- Every finger has exactly one owner, decided where it lands: the movement stick, the look area, one button, or the menu
  pointer. A second finger on an area that already has one does nothing until lifted, so input is never doubled or
  stolen. Lifting, cancelling (system gestures), losing capture, losing focus, hiding the page and rotating release
  everything the finger held, including movement.
- Look: the finger's travel since its previous event, in CSS pixels, times the look speed (degrees per pixel,
  horizontal and vertical separately) goes to the engine once (`Browser_Look`) and is applied at its next input frame.
  No acceleration, smoothing or spring-back stick; lifting stops turning at once and the next touch starts where it lands.
  Because CSS pixels are used, the same swipe turns the same angle at any render resolution, picture shape,
  device pixel ratio or frame rate (measured, see STATUS.md). While zoomed (scopes) the game's own zoom scaling applies,
  times the "aiming speed when zoomed" setting. Turning is discarded, not stored up, while a menu, the console, a
  cinematic or the pause is active.
- Movement is analog (`Browser_Move`, fraction of walking speed, added once per user command); pushed to the edge it
  also holds Run.
- Fire can be dragged to aim while firing (on by default); its travel is counted by the Fire button only, never also by
  the look area. An optional second Fire button sits on the movement side.
- Adjustable: input mode, look speed (horizontal/vertical), aiming speed, invert vertical, Fire drag, second Fire,
  left-handed layout, button size, opacity and distance from the side and bottom edges; Reset restores the defaults.
- While one of the game's menus is open, only Menu (back) stays and a finger is the menu pointer (direct positioning).
- Pointer lock is never requested for touch; scrolling and zooming are blocked only on the game surface and overlay.
- Earlier versions sent touch look as synthetic mouse motion. Without pointer lock the engine's input layer ignores
  relative motion and uses the absolute pointer position instead, scaled by render resolution / CSS size: every new touch
  jumped the view, the look-speed setting had no effect and the turn rate changed with resolution. Replaced by the
  direct path above.

## Controller

- The engine reads controllers through `src/input/gamepad.ts`, which shows it one controller in the standard layout:
  the physical controller chosen in Settings (or the first one used), with the browser's mapping for "standard"
  controllers and a guess for others, correctable with **Calibrate / remap** (stick directions, then each button;
  triggers and d-pads on axes are supported; stick rest positions are measured and subtracted). SDL 3.4's browser
  backend applies one fixed standard layout to every device and has no mapping database for browsers, so a controller
  the browser reports with an empty mapping got wrong or no sticks and buttons before.
- Look speed is degrees per second at full deflection (`joy_yawspeed`/`joy_pitchspeed`, set by the page at every
  start with the curve `joy_right_expo`, dead zone `joy_left/right_deadzone` and the boost `joy_extra_yawspeed`;
  negative pitch for inversion); frame-rate independent (rate × frame time). See "Aiming speed" above.
- Engine fixes: **the sticks did nothing in play** – SDL's axis events take the first deflection they see as the
  stick's rest position and only report later changes, and the engine read the sticks from those events only; it now
  reads the current stick positions from SDL every input frame (found by the scripted-controller test: buttons and
  triggers worked, both sticks moved 0). SDL's "ignore controllers without keyboard focus" filter is off in the
  browser. Stick positions are kept while a menu is open (a stick released in a menu stayed "pushed" after
  returning), and stick movement is added once per user command (it was summed over every input frame, so its strength
  grew with the frame rate).
- Disconnecting the controller pauses a single-player game (engine behaviour); reconnecting makes it usable again.
  A controller connected before or during play is opened by the engine two frames after the page hands it over
  (openMERC waited 100 frames, a desktop workaround for controllers that appear as two devices; the page always shows
  exactly one). The press that reveals a controller to the browser happens before that and is not seen by the game.
- Browsers reveal a controller only after a button is pressed on the open page, and only on secure (HTTPS or
  localhost) pages. iOS Safari exposes only controllers that iOS itself supports as game controllers (Apple's
  GameController framework: MFi, Xbox, PlayStation and some others); whether a given controller appears is decided
  there, not by this page.
- **Input diagnostics** (startup page → Settings) with **Copy report**: secure context, Gamepad API, installed-app
  state, browser, input mode, focus; every controller's id, mapping, button and axis counts and raw values; the state
  handed to the game (standard layout) with the expected actions; the page's controller events (including how many
  controllers were reported before the first press); and the **last game session**: four times a second during play
  the page records the raw input, the state handed to the game and what the engine holds (`Browser_PadState`: SDL's
  stick values and the keys it has down for each button), with the game's state (play, menu, pause, cinematic). The
  report ends with a verdict naming the stage where input stopped. Access keys are removed from the report. An
  optional readout during play shows the same live.

## Mobile orientation

Play on phones and tablets is landscape only (the startup page works in both). Play in portrait shows a rotate screen
first. Rotating to portrait during play releases all inputs and covers the game; a single-player level is paused and
needs a tap to resume after rotating back; multiplayer is only covered (the server keeps running). Landscape lock is
requested where the browser allows it (usually Android, fullscreen only); refusal is normal. Returning from the
background on a handheld device also pauses a single-player level until a tap.

## Aiming speed (defaults since round 10)

Measured in the game (tsr1, `work/tools/pw/aim-measure.mjs`, 932x430 CSS px view; identical at 1280x720 and with a
30 frames/s cap):

| | Round 8 defaults | Current defaults |
| --- | --- | --- |
| Touch look | 0.30°/px (280° for a full screen-width swipe, 69° for a quarter) | 0.45°/px horizontal, 0.35°/px vertical (419° / 104°) |
| Right stick 25 / 50 / 75 % | 2 / 27 / 80 °/s | 20 / 97 / 205 °/s |
| Right stick full | 160 °/s, ramping to ~380 °/s at the edge (hidden boost) | 330 °/s (vertical 220), no boost |
| 180° turn, stick full | 0.67 s | 0.62 s (0.55 s without input polling latency) |

Controller settings: look speed horizontal/vertical (°/s at full deflection), dead zone (default 0.12), response curve
(exponent on the deflection beyond the dead zone: linear 1.0, **balanced 1.5** (default), precise 2.0 – openMERC's own
default was 2.0), invert vertical, and an explicit, off-by-default **turn boost** (openMERC's edge ramp: +220 °/s
horizontally within 0.35 s at the stick's edge; before round 10 it was always on and not shown). Touch keeps direct
response (no acceleration or smoothing), separate horizontal/vertical speed, invert vertical and the zoomed-aim factor.

These are this project's approximation, not HCE Mobile's values. Verified from HCE Mobile's public `input.js`: touch
look sends the finger travel since the previous touch event times the look sensitivity times 2 to the game as mouse
movement (default sensitivity 1.4; mouse movement is scaled by sensitivity / 1.4), with no smoothing or acceleration in
that script; controller sticks are passed to the game unchanged (scaled to ±32767). How the Halo engine turns those
units into degrees is not in that script, so its turn rates in degrees could not be established.

Stored settings from round 8: values that still equal the round-8 defaults are moved to the new ones on the next visit;
values the player chose are kept, and the page offers **Apply updated recommended controls** (look speeds, dead zone,
curve, boost; inversion and the chosen controller stay) or **Keep my settings**.

## Verification status

**Physical, user-reported (2026-10-29):** iPhone 18 Pro Max, latest iOS / Safari available to the user (versions not
given), Ohsnap MCON over Bluetooth, LAN host mode: setup, Home Screen installation, pairing, MCON gameplay,
disconnect/reconnect, background/resume and save/load worked (checklist steps 1-7, round 9 build). The round-10 aiming
defaults and the train-enemy fix are not yet physically verified. Everything else: simulated (Playwright with Chrome
DevTools touch events and a scripted `navigator.getGamepads()`), see STATUS.md. Weapon slots 1–12, item quick keys and
wave gestures have no dedicated controller/touch button; cycling covers weapon and item selection.
