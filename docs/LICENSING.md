# Licensing and provenance

This is an engineering record, not legal advice. Statements quoted from upstream are the upstream project's own
claims.

## This repository

The browser front end (`src/`, `index.html`, `scripts/`, `tests/`) is original work of this project. **No license
has been chosen yet** (`package.json`: `UNLICENSED`). Because a playable build combines it with GPL-licensed
WebAssembly, the chosen license must be GPL-2.0-compatible for distribution of such a build.

`patches/openmerc-v0.2.2/` modifies GPL-2.0-or-later files of openMERC and is distributed under
**GPL-2.0-or-later** like the files it changes.

## openMERC (engine, fetched at build time)

- Upstream: <https://github.com/sidreshot/openMERC>, tag v0.2.2, commit `b54c135a16bcf95a33da8e18662a46940ff5fa28`.
- License: `LICENSE` is the GNU GPL version 2 text; the source files carry `SPDX-License-Identifier:
  GPL-2.0-or-later`. It includes code from Yamagi Quake II / id Software's Quake II (GPL) and permissively licensed
  components listed in upstream `THIRD_PARTY.md`.
- Distributing the WebAssembly build means providing the corresponding source (pinned upstream commit + these
  patches + the build script), the license text and the notices. `scripts/build-engine.sh` copies openMERC's
  `LICENSE` and `THIRD_PARTY.md` next to the engine.
- Notices still to be added before any distribution: Emscripten runtime and its SDL3 port, Emscripten's OpenAL
  implementation, OpenAL Soft headers (reverb presets are compiled in), and components found in the openMERC tree
  but not listed in its notice files.

## Material of unresolved provenance: the build is NOT DEPLOYABLE

openMERC's own legal notes (`docs/LEGAL_NOTES.md` at the pinned commit) state that some gameplay tables were taken
over as whole tables from its reverse-engineering team's material and that "the risk is not zero"; upstream plans to
replace them by black-box re-measurement. All of them are compiled into the **game module (`gamex86.so`)**:

| Upstream file | Content (structure only) | Status here |
| --- | --- | --- |
| `game/src/damage/g3_gore_tables.inc` | gore / dismemberment zone rules | unresolved: needs replacement |
| `game/src/damage/g3_humananims.inc` | per-animation gameplay attributes | unresolved: needs replacement |
| `game/src/props/prop_tables.cpp` | prop definitions | unresolved |
| `game/src/script/script_ai_table.inc` | script AI command ids | unresolved |

Lower-confidence candidates still under review: a small weapon table in the player module (`player.so`); small
engine-side tables (`openMerc.wasm`). openMERC's own data archive (`zz_openmerc.pak`: replacement menu pages, string
packages, OFL fonts and configs) is no longer built or shipped: the port shows the game's original menus from the
player's own archives.

This repository does not contain those files or any part of them (the patches do not touch them). A build produced by
`npm run engine` does contain them in compiled form, so `npm run check:dist` marks `engine/gamex86.so` as
**NOT DEPLOYABLE** and exits with status 2. Do not publish or host a playable build until this is resolved (upstream
replacement, a separate permission, or an independent re-implementation of those tables).

## Game data

Soldier of Fortune's data is not part of this project and must never be committed, bundled or served. The page reads
the player's own files locally; `check:dist` fails on any PACK archive or game-data file in the build.

## Notices

`public/THIRD_PARTY_NOTICES.md` (served with the page) lists the third-party components of the build; the engine
build copies the license texts of the Emscripten runtime, musl, libc++/libc++abi, compiler-rt and SDL 3 into
`engine/licenses/`. Adding the notices does not resolve the provenance question above: the build stays NOT DEPLOYABLE.
