# Third-party notices

This page and its engine contain or are built from the following third-party software. Soldier of Fortune's game data
is **not** included; each player uses their own copy.

## Shipped with the page (`engine/`)

| Component | Where | License | License text |
| --- | --- | --- | --- |
| openMERC v0.2.2 (engine, renderer, game, player and sound modules), with this project's patch | `openMerc.wasm`, `openMerc.js`, `ref_gles3.so`, `gamex86.so`, `player.so`, `OMsnd.so` | GPL-2.0-or-later | `engine/openMERC-LICENSE.txt` |
| Components openMERC is built on (Yamagi Quake II, id Software's Quake II 3.19, stb_truetype, …) | inside the files above | see openMERC's list | `engine/openMERC-THIRD_PARTY.md` |
| Emscripten runtime and JavaScript library code (including its OpenAL and IndexedDB file system implementations) | `openMerc.js`, `openMerc.wasm` | MIT or University of Illinois/NCSA | `engine/licenses/emscripten.txt` |
| musl libc (as adapted by Emscripten) | `openMerc.wasm` and modules | MIT | `engine/licenses/musl.txt` |
| LLVM libc++, libc++abi, compiler-rt | `openMerc.wasm` and modules | Apache-2.0 WITH LLVM-exception | `engine/licenses/libcxx.txt`, `libcxxabi.txt`, `compiler-rt.txt` |
| SDL 3.4.2 (Emscripten port) | `openMerc.wasm`, `openMerc.js` | zlib | `engine/licenses/sdl3.txt` |

The OpenAL Soft 1.25.2 public headers are used only to compile the sound module (constants and declarations); the
OpenAL implementation in the browser is Emscripten's. openMERC's own data archive with its fonts is not shipped.

## Used only by the optional local servers (not part of the page)

| Component | Where | License |
| --- | --- | --- |
| ws 8 (WebSocket server) | `server/mp-gateway.mjs`, installed by npm from the lockfile | MIT (in `node_modules/ws/LICENSE`) |
| Node.js 24, Debian 13 packages | Docker images built locally from `server/docker/*.Dockerfile`; not distributed | their own licenses |

## Used only to build and test (not shipped)

Vite, TypeScript, Vitest, Playwright, the Emscripten SDK and its compilers, CMake, Ninja: each under its own license,
installed by the developer.
