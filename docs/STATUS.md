# Status

Last updated 2026-10-29. Test machine: Windows 11, NVIDIA RTX 4060 Ti, Google Chrome (headless and windowed,
driven by Playwright); game data: Platinum Edition 1.07f (GOG, English). Evidence levels: *browser-tested* = automated
tests in a real browser with the real game data; *segment* = started with a console command rather than reached by
play; *not verified* = not tested.

**Not deployable** (see [LICENSING.md](LICENSING.md)). **No full-game, mobile, Firefox or Safari support is claimed.**

## Works (browser-tested)

| Area | Result |
| --- | --- |
| Startup page | folder / file / drag-and-drop selection; validation names the detected edition in < 0.1 s; missing, corrupt and case-duplicate archives rejected with specific messages; disc-image hint; nothing uploaded and no third-party requests (network log) |
| Original presentation | after Play the page is hidden; the game's own violence warning, intro animation and ARC main menu, with original fonts, tool tips and ticker; game letterboxed at 4:3 in the window or in browser fullscreen (chosen before launch, kept through resolution changes); no browser controls over the game ([PRESENTATION.md](PRESENTATION.md)) |
| Menu flow by clicks on the original pages | main menu → Game → Start Game → difficulty → tsr1 (cinematic skippable) → play → Esc → Save tab → New Savegame (with thumbnail, "Saves Left" count) → Load tab → load restores the exact position in the same session → Quit → Yes → back on the startup page with the saves stored |
| Original options pages | Keys, Video, Audio, Scale and Misc pages open; the Video page's Resolution row changes the render resolution (640x480 … 1600x1200) |
| Rendering | all 31 campaign maps and the tutorial load (segment, 32 maps in one session, tsr2 included) without engine errors |
| Audio | OpenAL → Web Audio at 48 kHz; output level measured; resumes after a click when suspended |
| Keyboard + mouse | original default bindings; in menus the game's cursor follows the pointer; during play a click captures the mouse; move, strafe, mouse look, fire (mouse and Ctrl) |
| Touch (emulated touch events) | taps operate the original menus (main menu → new game); move stick, look drag, fire, three fingers at once, no keys left held; only shown for touch use |
| Saves | original save/load pages and F6 / F7; saves and settings survive closing the browser (stored automatically after every save); export → delete → import on the startup page |
| Level change | tsr1 → tsr2 carry-over level change (segment) |
| Data streaming | archives are read on demand through a 48 MB cache instead of a 785 MB copy: renderer peak 560 MB instead of 1,315 MB after two levels; works for local files and LAN-hosted data ([LAN.md](LAN.md)) |
| LAN host mode | the PC serves the page and its own archives (read-only, tester key, LAN clients only, HTTPS with a local CA); the startup page finds and validates them and plays without a file picker; full menu flow verified from this PC over the LAN address. **Not yet tested from a phone** |
| Multiplayer (LAN) | two browser clients on a native 32-bit openMERC dedicated server through the WebSocket-to-UDP gateway: join (also through the original Join page), movement, damage, kill, respawn, score, disconnect/reconnect, map change, 10-minute sustained play ([MULTIPLAYER.md](MULTIPLAYER.md)) |
| Enemies | fight and move in tsr1, gore/dismemberment present (segment, sound evidence) |

## Partly working / not verified

- **Controller:** detected as a standard gamepad; trigger fire, A jump and navigation of the original menus (d-pad,
  A, B) work with a *scripted* gamepad. **Analog sticks are not verified**: the scripted stand-in does not produce usable
  stick input; a physical controller is needed.
- **Full campaign:** not played through. The open game module of openMERC v0.2.2 lists its AI, vehicles/helicopters, props
  and some cinematics as unfinished (upstream `docs/KNOWN_ISSUES.md`); e.g. the trn1 ending and the ger4 boss are open.
- **Comparison with the original runtime:** the original Windows game could not be run on the test machine (its 1999
  renderer crashes with the current driver), so the port is compared with the original's own menu definitions and art,
  not with captures of the original running.
- **Esc with a captured mouse in a window:** browsers may use the first Esc to release the mouse (untested with real
  keys; synthetic test keys bypass this browser rule). In fullscreen the page asks the browser to pass Esc to the game.
- **Memory:** with streaming, renderer ≈ 0.56 GB and GPU process ≈ 0.45 GB after two levels on the test PC; phones are
  not verified (see LAN.md for the breakdown).
- **Browsers:** only Chrome on Windows tested. Physical touch screens and phones not tested.
- **Multiplayer:** LAN only, through the gateway; no internet server list, no hosting from inside the browser; more than two players and phone/Wi-Fi clients not tested.

## Changes to the original behaviour

Listed with reasons in [PRESENTATION.md](PRESENTATION.md): browser letterbox instead of display-mode switching, the
first-start resolution, HUD scaling, the menu pointer, controller and touch input, and the remaining openMERC engine
behaviour.
