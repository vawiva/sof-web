#!/usr/bin/env bash
# Builds the openMERC engine and its modules for the browser (Emscripten, WebAssembly + WebGL2)
# into public/engine/. Upstream source is fetched at a pinned commit and patched; it is not vendored.
#
# Requires: git, cmake >= 3.20, ninja, python 3, curl, and an activated Emscripten SDK (emcc on PATH).
# Environment: SOF_ENGINE_CACHE (default .cache/engine) for sources and build trees.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
UPSTREAM=https://github.com/sidreshot/openMERC.git
TAG=v0.2.2
COMMIT=b54c135a16bcf95a33da8e18662a46940ff5fa28
OPENAL_TAG=1.25.2 # OpenAL Soft public headers, used to compile only (Emscripten provides the implementation)
CACHE=${SOF_ENGINE_CACHE:-$ROOT/.cache/engine}
SRC=$CACHE/openMERC-$TAG
OUT=$ROOT/public/engine

command -v emcc >/dev/null || { echo "emcc not found: activate the Emscripten SDK first" >&2; exit 1; }
mkdir -p "$CACHE"

patch_sum=$(cat "$ROOT"/patches/openmerc-$TAG/*.patch | sha256sum | cut -d' ' -f1)
if [ -d "$SRC" ] && [ "$(cat "$SRC/.port-patch-sha256" 2>/dev/null)" != "$patch_sum" ]; then
	rm -rf "$SRC" # patches changed: start again from the pristine tag
fi
if [ ! -d "$SRC" ]; then
	git clone --quiet --depth 1 --branch "$TAG" "$UPSTREAM" "$SRC.tmp"
	got=$(git -C "$SRC.tmp" rev-parse HEAD)
	if [ "$got" != "$COMMIT" ]; then
		echo "openMERC $TAG resolved to $got, expected $COMMIT" >&2
		exit 1
	fi
	for p in "$ROOT"/patches/openmerc-$TAG/*.patch; do
		git -C "$SRC.tmp" apply --whitespace=nowarn "$p"
	done
	echo "$patch_sum" > "$SRC.tmp/.port-patch-sha256"
	mv "$SRC.tmp" "$SRC"
fi

AL=$CACHE/openal-soft-$OPENAL_TAG
if [ ! -f "$AL/AL/efx.h" ]; then
	mkdir -p "$AL/AL"
	for h in al.h alc.h alext.h efx.h efx-presets.h; do
		curl -sfL "https://raw.githubusercontent.com/kcat/openal-soft/$OPENAL_TAG/include/AL/$h" -o "$AL/AL/$h"
	done
fi

common=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_POSITION_INDEPENDENT_CODE=ON
	"-DCMAKE_C_FLAGS=--profiling-funcs" "-DCMAKE_CXX_FLAGS=--profiling-funcs")
emcmake cmake -S "$SRC/engine" -B "$CACHE/build-engine" "${common[@]}" \
	-DCURL_SUPPORT=OFF -DGL3_RENDERER=OFF -DGLES3_RENDERER=ON -DXDG_SUPPORT=OFF -DOM_SOFPM_TESTS=OFF \
	"-DCMAKE_EXE_LINKER_FLAGS=--profiling-funcs" "-DCMAKE_MODULE_LINKER_FLAGS=--profiling-funcs"
emcmake cmake -S "$SRC/game" -B "$CACHE/build-game" "${common[@]}" -DOM_G3_TESTS=OFF
emcmake cmake -S "$SRC/player" -B "$CACHE/build-player" "${common[@]}"
emcmake cmake -S "$SRC/modules/sound" -B "$CACHE/build-sound" "${common[@]}" "-DOM_OPENAL_HEADERS=$AL"
# BUILD_JOBS bounds the parallel compiler processes (each emcc can take hundreds of MB): 4 by default
for b in engine game player sound; do
	cmake --build "$CACHE/build-$b" --target all --parallel "${BUILD_JOBS:-4}"
done
# openMERC's own data archive (zz_openmerc.pak: replacement menus, fonts, key layout) is neither built nor
# shipped: the port presents the game's original menus from the player's own archives.

rm -rf "$OUT"
mkdir -p "$OUT"
cp "$CACHE/build-engine/release/openMerc.js" "$CACHE/build-engine/release/openMerc.wasm" \
	"$CACHE/build-engine/release/ref_gles3.so" "$OUT/"
cp "$CACHE/build-game/gamex86.so" "$CACHE/build-player/player.so" "$CACHE/build-sound/OMsnd.so" "$OUT/"
cp "$SRC/LICENSE" "$OUT/openMERC-LICENSE.txt"
[ -f "$SRC/THIRD_PARTY.md" ] && cp "$SRC/THIRD_PARTY.md" "$OUT/openMERC-THIRD_PARTY.md"

# license texts of what Emscripten compiles into the engine (see THIRD_PARTY_NOTICES.md), taken from the SDK in use
EMROOT=$(dirname "$(command -v emcc)")
mkdir -p "$OUT/licenses"
cp "$EMROOT/LICENSE" "$OUT/licenses/emscripten.txt"
cp "$EMROOT/system/lib/libc/musl/COPYRIGHT" "$OUT/licenses/musl.txt"
cp "$EMROOT/system/lib/libcxx/LICENSE.TXT" "$OUT/licenses/libcxx.txt"
cp "$EMROOT/system/lib/libcxxabi/LICENSE.TXT" "$OUT/licenses/libcxxabi.txt"
cp "$EMROOT/system/lib/compiler-rt/LICENSE.TXT" "$OUT/licenses/compiler-rt.txt"
sdl_license=$(ls "$EMROOT"/cache/ports/sdl3/SDL-*/LICENSE.txt 2>/dev/null | head -1)
[ -n "$sdl_license" ] && cp "$sdl_license" "$OUT/licenses/sdl3.txt"

cat > "$OUT/engine.json" <<JSON
{ "upstream": "$UPSTREAM", "tag": "$TAG", "commit": "$COMMIT", "patchSha256": "$patch_sum",
  "emcc": "$(emcc --version | head -1 | sed 's/"/\\"/g')" }
JSON
echo "engine written to $OUT"
ls -l "$OUT"
