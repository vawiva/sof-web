# Soldier of Fortune in the browser

A browser front end for **Soldier of Fortune** (Raven Software, 2000) that runs the game from the player's
**own installed copy**. It pairs a game-specific startup page (Vite + TypeScript) with
[openMERC](https://github.com/sidreshot/openMERC), an open-source engine for Soldier of Fortune, compiled to
WebAssembly with WebGL 2 rendering.

![The startup page: game data detected and ready to play](docs/images/startup-desktop.png)

**New here? Follow the [setup guide](docs/SETUP.md)**: tools, build, playing on the PC, on a phone over your home
network, offline on the phone, controllers and local multiplayer.

> **Status: work in progress, not deployable.** See [docs/STATUS.md](docs/STATUS.md) for what has been verified, and
> [docs/LICENSING.md](docs/LICENSING.md) for why a playable build must not be published yet.

## What this repository contains

| Path | Content |
| --- | --- |
| `index.html`, `src/` | Startup page: file/folder selection, validation, settings and saves, touch and controller layers, engine adapter |
| `patches/openmerc-v0.2.2/` | Changes that make openMERC v0.2.2 build and run under Emscripten |
| `scripts/build-engine.sh` | Fetches openMERC at a pinned commit, applies the patches, builds the WebAssembly engine into `public/engine/` |
| `server/` | LAN host (game data for phones, pairing), multiplayer gateway, Docker Compose setup |
| `pwa/` | Service worker template (installed app, offline use) |
| `scripts/check-dist.mjs` | Inspects a production build for game data, private paths and material of unresolved provenance |
| `tests/` | Unit tests with synthetic archives only |
| `docs/` | Build, controls, presentation, licensing and status notes |

It contains **no game data** and no copy of openMERC's source. The finished page asks every player for their own
files; they are read locally and never uploaded.

## How it plays

After the files are checked, **Play fullscreen** or **Play in this window** starts the game exactly as the original
does: the violence warning, the intro animation and the original main menu. From then on the browser page is gone:
the game fills the window at its original 4:3 shape (black bars where the window is wider or taller) and shows only
the original menus and HUD. Loading, saving, settings, controls and quitting use the game's own menus. **Quit** in the
main menu stores settings and saves and returns to the startup page. Browser-only tools (exporting and importing
saves, deleting stored data, touch layout, the console key) are on the startup page. Deviations from the original
presentation are listed in [docs/PRESENTATION.md](docs/PRESENTATION.md).

## Supported game data

Tested: **Platinum Edition 1.07f (GOG, English)** and the **2001 Platinum CD**. The player selects the installation
folder or its `base` folder; the page needs `pak0.pak`–`pak3.pak` and `gs.pak` (about 785 MB). The GOG installer
(`.exe`) and the CD image (`.iso`) can also be selected: the page unpacks the five archives into browser storage without
running anything. Other 1.07f installations are accepted as *unverified* when they contain the full campaign.

The game data can come from the device itself, be kept in the browser's storage for offline play, or be streamed from
a PC on the same home network ([LAN host](docs/LAN.md)).

## Build

Step by step: [docs/SETUP.md](docs/SETUP.md); reference: [docs/BUILD.md](docs/BUILD.md). In short:

```sh
npm ci
npm run engine      # needs an activated Emscripten SDK, cmake, ninja, python, git, curl
npm run typecheck && npm test
npm run build       # -> dist/
npm run check:dist  # exit 2 = not deployable (unresolved third-party material), 1 = forbidden content
npm run preview
```

## Browser requirements

WebAssembly, WebGL 2 and IndexedDB; HTTPS (or localhost) for controllers, the installed app and offline storage. The
archives are read in pieces through a 48 MB cache; the page needs roughly 600 MB plus graphics memory. Tested in
desktop Chrome on Windows (automated) and, by the user, on an iPhone with Safari as an installed web app with a
Bluetooth controller. Other browsers and devices are not verified; see [docs/STATUS.md](docs/STATUS.md).

## Not affiliated

Soldier of Fortune is a trademark of its owners. This project is not affiliated with or endorsed by Raven Software,
Activision or openMERC.
