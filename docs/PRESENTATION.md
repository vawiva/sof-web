# Original presentation

The port shows Soldier of Fortune the way the original 1.07f release does: its own start-up, menus, fonts, HUD and
dialogs, read from the player's own archives and interpreted by openMERC's menu runtime. Apart from the startup page
(needed to choose the game files) there is no browser interface on top of the game. This page records the original
flow the port follows and every place where it still differs.

Evidence: the menu definitions and scripts in the tested data (Platinum Edition 1.07f, GOG, English: `default.cfg`,
`menus/*.rmf`, `menus/*.cfg`), and browser runs of the port that follow the flow below with mouse, touch and a scripted
controller. A side-by-side capture of the original Windows game was not possible on the test machine: its 1999
`ref_gl.dll` crashes on start with the current graphics driver (access violation in the renderer, before the first
frame). Comparisons are therefore against the original's own page definitions and art, not against video of the
original.

## Original flow (from the game's scripts)

| Step | Original definition | In the port |
| --- | --- | --- |
| Start | `default.cfg`: `alias start "menu disclaimer"`, run when the command line holds no `+` commands | The page passes its settings as `+set` and then `+start` explicitly (any other `+` command would skip the start, as in the original) |
| Violence warning | `menus/disclaimer.rmf` / `m_disclaimer.rmf`: red title text on black, `<timeout 3.0 "menu intro">` | Same page and timing |
| Intro | `menus/intro.rmf`: full-screen intro animation (Ghoul model `intro`), any key skips to `amain` | Same |
| Main menu | `menus/amain.rmf` / `a_amain.rmf`: ARC console with the globe, six buttons (Game, Multiplayer, Options, Statistics, Lock, Quit) with tool tips, scrolling welcome ticker, version `1.07fx86F` | Same pages, fonts, sounds and tool tips |
| New game | Game button → `game.rmf` (codename, Play Tutorial, Start Game) → `game3.rmf` (Effortless … Unfair, Custom → `game2.rmf`) → `freshgame` → `menus/newgame.cfg` → `map tsr1` | Same; tsr1 opens with its in-engine cinematic (Esc skips it, as in the original) |
| In game | Esc → `menus/main.rmf` (the ARC console over the paused game); Game → folder tabs Start / Load / Save / Credits; Options → Keys / Video / Audio / Scale / Misc | Same; save and load use the original pages, slot limits ("Saves Left") and thumbnails |
| Quit | Quit button → `quit.rmf` "Exit game – are you sure?" → `quit` | Same dialog; quitting stores settings and saves in the browser and returns to the startup page |

## Deviations

| Area | Original | Port | Reason | How to change |
| --- | --- | --- | --- | --- |
| Window | Switches the display to the chosen resolution (fullscreen by default) | The page shows the game letterboxed at 4:3 in the browser window; browser fullscreen is offered before launch (**Play fullscreen**). The video page's Fullscreen and Bitdepth rows are hidden with the original's own switches (`menu_nofullscreen`, `menu_notruecolour`) | A web page cannot change the display mode; the browser decides about fullscreen | Browser fullscreen: F11, or **Play fullscreen** |
| Resolution | Default 640x480 (`gl_mode 3`) | First start: the largest of the original's 4:3 resolutions (640x480 … 1600x1200) that fits the window; the video page's Resolution row still selects any of them, and the browser scales the picture to the window | 640x480 is blurred when enlarged to a modern window | Options → Video → Resolution, Apply |
| HUD size | Drawn 1:1 in pixels at every resolution (smaller at higher resolutions) | Scaled with the resolution so it keeps its 640x480 proportions (openMERC `scr_hudscale 0`) | Keeps the same picture at every window size | Console (if enabled): `scr_hudscale 1` |
| Menu pointer | Moved by relative mouse movement while the game holds the mouse | In the menus the game's own cursor follows the browser's pointer (the system pointer is hidden over the game); the mouse is captured (pointer lock) only during play, after a click | Browsers allow capture only after a click; menus come up before any click | — |
| Esc during play | Opens the menu | Opens the menu. In a window, a browser that holds the captured mouse may use the first Esc to release it, and a second Esc opens the menu; in **Play fullscreen** the page asks the browser to give Esc to the game (Chromium: hold Esc to leave fullscreen) | Browser rule for pointer lock and fullscreen | Play fullscreen |
| Rows without effect | Video driver (OpenGL / 3Dfx), sound driver, sound frequency, sample size, exclusive DirectSound buffer | Shown as in the original; they have no effect in a browser | No such hardware choice in a browser | — |
| Console | Off unless started with `+set console 1` | Off by default; the startup page's Browser settings can enable the console key | — | Startup page → Advanced |
| Multiplayer | Internet and LAN play (GameSpy / direct IP) | LAN play through a local WebSocket-to-UDP gateway to a dedicated server; no internet server list and no hosting from inside the browser ([MULTIPLAYER.md](MULTIPLAYER.md)) | Browsers cannot send UDP datagrams | — |
| Installed app (mobile) | — (PC game) | On iPhone/iPad, Play is offered only in the installed web app (Home Screen; detected with `navigator.standalone`; browser fullscreen does not count); the Safari tab keeps setup, help, saves export/import and the install steps. On Android installing is offered prominently (the browser's install prompt where available, else menu steps) with **Continue in browser**; both play (landscape-only either way). Desktop browsers play without installing | Full screen without browser bars on iOS; the user asked for it | — |
| Mobile orientation | — (PC game) | On phones and tablets play is landscape only: a rotate screen (no game controls on it) appears before launch in portrait and whenever the device is turned upright; a single-player level pauses and resumes with a tap after turning back, multiplayer is only covered. Landscape lock is requested where the browser allows it | Touch controls and the 4:3 HUD need landscape | — |
| Touch and controller | Keyboard, mouse, joystick | Touch controls (only in touch mode, adjustable, not over the menus) and a controller adapter with calibration; an optional input diagnostics readout during play, off by default ([CONTROLS.md](CONTROLS.md)) | Phones have no keyboard or mouse | Startup page → Settings → Controls / Controller / Input diagnostics |
| Widescreen (opt-in) | 4:3 only | Default 4:3 as the original. Browser settings → Display → Picture can choose 16:9 or "fill the screen" (up to 2.4:1): the resolution row keeps its height and the 3D view gets wider, with the original vertical field of view (openMERC `horplus`), so nothing is stretched or cropped. Menus keep their 640x480 page in the centre (openMERC fills the sides with the page backdrop); HUD elements keep their proportions and sit in the picture's corners; scripted cinematics keep their 4:3 framing (black sides) with their captions inside it. The Video page's resolution names stay the 4:3 ones | Optional, for wide screens and phones | Startup page → Browser settings → Display |
| Frame rate | Rendering as fast as the PC allows (vsync in the driver) | Pictures follow the browser's display frames; Browser settings → Display → Frame rate: 60 per second (default), the display's rate, or 30. The game itself (10 Hz server frames, movement, weapons, scripts, animation) runs at the same speed at every setting (measured, docs/STATUS.md) | Browsers schedule frames on the display refresh | Startup page → Browser settings → Display |
| Esc right after a cinematic skip | Esc during a cinematic skips it; every later Esc opens the main menu | Esc presses within 2 s of a skip, and during the single-player level load that follows it (up to 30 s), are taken as part of that skip and do not open the main menu (browser builds only; engine patch `CL_SkipEscapeSwallowed`) | Repeated taps of the touch Menu button or of a controller's Start while the cinematic ends opened the menu over the next level (paused), which looks like a hang | Esc once more after the level has started |
| Game data storage | Installed on the PC's disk | Optionally kept in the browser's private storage for this site, imported once from the archives, the 2001 CD image or the GOG installer, or downloaded from the paired PC ([INSTALL_ON_DEVICE.md](INSTALL_ON_DEVICE.md)) | Phones have no game installation | Startup page → Keep the game on this device |

openMERC engine behaviour that remains (from its own deviation list; all outside the visual design of the pages):
savegame dates in the load/save grid are shown as `2026-10-29 07:25` so they fit their cell; text inside bordered
buttons is centred vertically; menu lists also step with the arrow keys and d-pad; controller navigation of the menus
(d-pad, A, B, shoulders; the original had none); the parental-lock pages are not provided (the game always runs with
full violence). openMERC's own menu pages, fonts, side panel, widescreen layout, dimmed dialogs, version line and timed
autosaves are switched off or not loaded.

Engine gaps fixed in the port (the original behaves this way; openMERC v0.2.2 did not yet): characters standing on a
moving train are carried by it (tsr1's skinheads on the subway train; openMERC carried only players), and a map's
terrain set (trn1's scrolling landscape beside the train, `env/train.trn`) is selected when the map loads.
