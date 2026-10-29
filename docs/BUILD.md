# Building

## Tools (versions used for the tested build)

| Tool | Version |
| --- | --- |
| Node.js / npm | 24.20.0 / 11.6.2 |
| Emscripten SDK | 6.0.13 (`emsdk install 6.0.13 && emsdk activate 6.0.13`) |
| CMake / Ninja | 3.20 or newer / any recent |
| Python | 3.10 or newer |
| git, curl, bash | any recent (Git Bash on Windows works) |

## Engine

`npm run engine` (= `bash scripts/build-engine.sh`):

1. clones `https://github.com/sidreshot/openMERC.git` at tag `v0.2.2` and refuses to continue unless it resolves to
   commit `b54c135a16bcf95a33da8e18662a46940ff5fa28`;
2. applies `patches/openmerc-v0.2.2/*.patch` (re-applied from a fresh clone whenever the patches change);
3. downloads the OpenAL Soft 1.25.2 public headers (compile-time only; Emscripten provides OpenAL);
4. builds the engine (`openMerc.js/.wasm`), the WebGL 2 renderer (`ref_gles3.so`), the game (`gamex86.so`), player
   (`player.so`) and sound (`OMsnd.so`) modules as Emscripten side modules, and openMERC's data archive;
5. writes them, openMERC's license and third-party notices, and `engine.json` (versions, patch hash) to
   `public/engine/`.

Set `SOF_ENGINE_CACHE` to keep sources and build trees outside the repository.

## Web application

```sh
npm ci
npm run typecheck
npm test
npm run build        # Vite, output in dist/ (relative base path, works from any sub-directory)
npm run check:dist
npm run preview      # http://localhost:4173
```

## Hosting

The build is static files. Requirements:

- `.wasm` served as `application/wasm` (needed for streaming compilation);
- no cross-origin isolation headers are required (the engine is single-threaded);
- the page must be served over HTTPS (or localhost) for folder handles and storage.

Do not deploy while `npm run check:dist` reports `NOT DEPLOYABLE`; see [LICENSING.md](LICENSING.md).
