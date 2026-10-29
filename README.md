# Soldier of Fortune in the browser

A browser front end for **Soldier of Fortune** (Raven Software, 2000) that runs the game from the player's
**own installed copy**. It pairs a game-specific startup page (Vite + TypeScript) with
[openMERC](https://github.com/sidreshot/openMERC), an open-source engine for Soldier of Fortune, compiled to
WebAssembly with WebGL 2 rendering.

> **Status: work in progress, not deployable.** See [docs/STATUS.md](docs/STATUS.md) for what has been verified, and
> [docs/LICENSING.md](docs/LICENSING.md) for why a playable build must not be published yet.

## What this repository contains

| Path | Content |
| --- | --- |
| `index.html`, `src/` | Startup page: file/folder selection, validation, settings and saves, touch and controller layers, engine adapter |
| `patches/openmerc-v0.2.2/` | Changes that make openMERC v0.2.2 build and run under Emscripten |
| `scripts/build-engine.sh` | Fetches openMERC at a pinned commit, applies the patches, builds the WebAssembly engine into `public/engine/` |
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

Tested: **Platinum Edition 1.07f (GOG, English)**. The player selects the installation folder or its `base` folder;
the page needs `pak0.pak`–`pak3.pak` and `gs.pak` (about 785 MB). Other 1.07f installations are accepted as
*unverified* when they contain the full campaign. Disc images, installers and archives are not read directly.

## Build

See [docs/BUILD.md](docs/BUILD.md). In short:

```sh
npm ci
npm run engine      # needs an activated Emscripten SDK, cmake, ninja, python, git, curl
npm run typecheck && npm test
npm run build       # -> dist/
npm run check:dist  # exit 2 = not deployable (unresolved third-party material), 1 = forbidden content
npm run preview
```

## Browser requirements

WebAssembly, WebGL 2 and IndexedDB; about 1 GB of free memory for the tab (the game archives are held in memory, see
the status page). Tested in desktop Chrome on Windows. Other browsers and all mobile devices are not verified yet.

## Not affiliated

Soldier of Fortune is a trademark of its owners. This project is not affiliated with or endorsed by Raven Software,
Activision or openMERC.
