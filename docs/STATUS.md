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
| Touch (emulated touch events, real game) | look is relative and direct: a 200 px swipe turns 60.0° (0.30°/px), 40 px down 10.0° (0.25°/px), identical at 844x390 @3x, 1280x720 @1x and with a 30 frames/s cap; no jump on a new touch, no turning while the finger rests, a second finger on the look side is ignored (30.0° for one finger's 100 px), Fire dragged = fires and turns by its own travel once; analog move + look + Fire with three fingers; cancelled touches and lifted fingers leave nothing held; Menu opens the original menu, where drags do not turn the view. **Physical phone not tested** |
| Controller (scripted `navigator.getGamepads()`, real game) | standard layout: left stick moves, right stick turns, right trigger fires, A jumps, B crouches, right shoulder switches weapon, Start opens/closes the menu; a stick released while the menu was open does not keep moving; disconnect pauses, reconnect works again. Non-standard layout (mapping "", right stick on axes 3/4, hat d-pad) works through the adapter's guess; calibration/remap unit-tested. **Physical controller not tested** |
| Installed app and pairing (Chrome, loopback LAN host) | unpaired start of the installed app shows the pairing page; the six-digit code (typed with a space) pairs it; the PC's game data is then ready; paired devices get the icon made from the player's SoF.exe; manifest (standalone, landscape) and service worker active; only the page shell is cached (no game data, no engine); with the host stopped the installed shell says the PC is not reachable |
| iPhone-shaped WebKit (Playwright WebKit on Windows, not iOS Safari) | Safari tab: install steps instead of Play, setup works; installed (navigator.standalone): the game runs; a scripted controller connected during play moves and turns the player, the touch controls hide once its input reaches the game, an incidental tap right after does not bring them back, disconnect pauses and brings them back; the copied report names the stage input reached (WebKit ran at 9.5 frames/s here) |
| Mobile orientation (emulated phone) | portrait during play: rotate screen, single-player paused, inputs released; landscape: tap to resume, canvas 4:3 without stretching; repeated rotation resumes once |
| Startup page | redesigned (status line with edition and data source, Play / Play fullscreen, multiplayer status from the LAN host, settings groups, input diagnostics): no horizontal scrolling and all controls ≥ 44 px at 1280x800, 390x844 and 844x390 |
| Saves | original save/load pages and F6 / F7; saves and settings survive closing the browser (stored automatically after every save); export → delete → import on the startup page. **Fixed in this round:** the browser build saved no callbacks (openMERC encodes them as offsets in its module image, which a WebAssembly side module does not have: about 1,100 "Unable to enumerate" warnings per save), so after any load the level's triggers, relays, counters and doors no longer worked (tsr1's ending could not start after loading). Callbacks are now saved relative to a function-table anchor and a data anchor; verified: a counter's handler survives save → page reload → load, and the tsr1 ending chain runs to trn1 after save → reload → load (tsr1 only; an all-maps save/load sweep was started but not completed: its harness saved during opening cinematics and the run was stopped for low memory). Saves made before the fix still load (with a console warning) but keep the old defect: start the level again |
| Level change | tsr1 → tsr2 carry-over level change (segment) |
| Game kept on the device | **Keep the game on this device**: import of the five archives, of the 2001 Platinum CD image (.iso, its InstallShield 5 set) or of the GOG installer (.exe, Inno Setup 5.6.2 split pieces), or download from the paired PC; written in pieces to the browser's private storage (OPFS) by a worker, read back and checked (MD5), committed only when complete and validated; interrupted copies are not playable and resume; space check before copying; Verify, Remove (saves kept). Chrome, end to end for every source: import → play → save → close → server stopped and network off → reopen → Ready on this device → load the save at the saved position (19/19 checks per source; [INSTALL_ON_DEVICE.md](INSTALL_ON_DEVICE.md)). **Not tested on iOS/Android** (Playwright's Windows WebKit has no OPFS write backend) |
| Offline app | the service worker keeps the page and the engine (one version, 17 files); updates are downloaded completely before they replace the old version (tested: A → B, A removed, B opens offline); game data is never cached |
| Ending of tsr1 | the level's own chain (segment: started at the train stop with god mode): the stop-point wave and the three end guards killed with the player's own aimed fire → end counter → end cinematic → "mission accomplished" (acc2) → tsr2 briefing cinematic → trn1 playable, with mid-cinematic skips (34 s). Skips early / midway / late / repeated, with Esc, the touch Menu button and a controller's Start, and after save/load: trn1 playable each time (Chrome) |
| Session journal | a bounded record of the session's last moments (map, game state, skips, stalls, data reads, errors) survives a session the browser ends; the next start shows "did not end normally" with a copyable report, access keys removed (tested with a renderer crash) |
| Data streaming | archives are read on demand through a 48 MB cache instead of a 785 MB copy: renderer peak 560 MB instead of 1,315 MB after two levels; works for local files and LAN-hosted data ([LAN.md](LAN.md)) |
| LAN host mode | the PC serves the page and its own archives (read-only, tester key, LAN clients only, HTTPS with a local CA); the startup page finds and validates them and plays without a file picker; full menu flow verified from this PC over the LAN address. **Not yet tested from a phone** |
| Multiplayer (LAN) | two browser clients on a native 32-bit openMERC dedicated server through the WebSocket-to-UDP gateway: join (also through the original Join page), movement, damage, kill, respawn, score, disconnect/reconnect, map change, 10-minute sustained play ([MULTIPLAYER.md](MULTIPLAYER.md)) |
| Enemies | fight and move in tsr1, gore/dismemberment present (segment, sound evidence) |
| tsr1 subway train | the three skinheads ride on the train roof when the player crosses the trigger and are carried to the stop point (segment, regression); **they now fight**: carried on a train (moving or stopped, also after loading a save made there) they count as standing, so their combat plan aims and fires instead of idling – before, physics gave them no ground (a bounding-box prop is not taken as ground) and the combat plan only played idle animations. Measured (segment, player at the stop point, hits attributed by the game's damage trace): 20 shots, 54 damage from the train skinheads in 40 s; from mid-route the shots are legitimate long-range misses of the game's hit model. Physical retest pending |
| trn1 moving train | the scrolling landscape beside the train is drawn (about 475 terrain quads in view), moves while the game runs and stops while paused; the next map clears it (segment). Before the fix everything below the horizon was black. The soldiers woken by the trigger at the fourth car stay at their posts (as the map flags them), aim at the player and hit after a while (segment) |
| Widescreen (opt-in) | 16:9 at 1280x800 and "fill" on a 915x412 phone-shaped window: canvas and resolution have the chosen shape (no stretching), the 3D view fills it, cinematics stay 4:3 with captions inside, touch buttons leave the corner HUD visible; switching back to 4:3 in the same profile restores 4:3 at the same resolution row |
| Frame rate | Chrome on a 60 Hz display: 59.8 frames/s, frame time p50 16.7 ms / p95 17.1 ms at the default setting; 30.1 at the 30 setting; targets that do not divide the display rate (45 on 60 Hz, as 60 on 144 Hz) average correctly (44.9). Running distance (171 ± 1 units in 1.5 s) and the tsr1 train's speed (300 units/s) are the same at 20, 30, 45 and 60 frames/s; after a 5 s stall (as a hidden tab) the world does not fast-forward. **No high-refresh display was available** |

## Partly working / not verified

- **Physical, user-reported:** iPhone 18 Pro Max (latest iOS/Safari available to the user, versions not given), Ohsnap MCON
  over Bluetooth, LAN host: setup, Home Screen install, pairing, MCON gameplay, disconnect/reconnect, background/resume,
  save/load worked (round 9 build). Round 10 (aiming defaults, train-enemy combat) not yet retested on the phone.
- **Controller and touch on real devices:** implemented and simulated-tested; physical verification pending (the earlier
  report that the scripted stand-in "does not produce usable stick input" was wrong: the engine lost stick input, fixed
  in this round, see CONTROLS.md).
- **trn1 last-wagon side door - fixed in the port, not physically verified:** the sliding side door of the nuke wagon
  ignored the use key, so trn1 could not be finished. The door's team leader is a hidden brush named for scripts, and
  the engine refused the use key for the whole team when the leader was named; the used panel's own name now decides.
  Segment regression (trn1-door.mjs): the door stays shut until Use, opens, the player enters, the grate opens when its
  latch is shot and the outro leads to arm1; also after a save and load outside the door. Doors with the same team
  pattern in ger2, irq1a, kos3 and sib3 may now answer the use key where they did not before (to be checked in play).
- **tsr1 ending freeze - reopened, reproduced by the user, not reproduced here, fix not physically verified:** a
  second report places it right after the red "mission accomplished" screen (the change to tsr2). An engine fault
  (WebAssembly trap) stops the game loop silently with the last frame on screen; such a fault now shows the error
  screen and is recorded with its engine functions in the session report. The cause in the user's run is not yet
  known. First report: in
  desktop Chrome with the 2001 CD image stored in the browser, a new game, the train-stop fight finished normally;
  skipping while the screen faded to black brought back the last gameplay view, frozen. Not reproduced in headless
  Chrome with the same data path, a new game through the menu's own command, the train encounter and the real
  ending chain: no skip, presses at 0, 0.3, 1, 5 and 12 s into the cutscene, repeated presses, Esc on the "mission
  accomplished" screen, the player standing in the end actors' path all reached trn1. Headless tests cannot capture
  the mouse, so the real-key Esc-with-captured-mouse case (below) is untested. The session report now records
  builds, controller presses, mouse capture and an engine snapshot, and keeps a stuck session reportable.
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
