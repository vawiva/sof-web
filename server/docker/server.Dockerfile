# Native openMERC dedicated server for local multiplayer tests. Build it for linux/386 (compose.yaml does): the game
# and player modules use the original game's 32-bit object layout (fixed WeaponDesc offsets in player_api.h), so a
# 64-bit server never fires a weapon (verified: FireBullet is not reached on x86_64).
# Built from the pinned upstream commit plus this project's patch; the image contains no game data. The player's
# own archives are mounted read-only at run time (see compose.yaml and docs/MULTIPLAYER.md).
FROM debian:trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
		build-essential cmake ninja-build git ca-certificates python3 pkg-config libsdl3-dev zlib1g-dev \
	&& rm -rf /var/lib/apt/lists/*
ARG OPENMERC_TAG=v0.2.2
ARG OPENMERC_COMMIT=b54c135a16bcf95a33da8e18662a46940ff5fa28
WORKDIR /src
RUN git clone --quiet --depth 1 --branch "$OPENMERC_TAG" https://github.com/sidreshot/openMERC.git om \
	&& test "$(git -C om rev-parse HEAD)" = "$OPENMERC_COMMIT"
COPY patches/openmerc-v0.2.2/ /patches/
RUN for p in /patches/*.patch; do git -C om apply --whitespace=nowarn "$p"; done
# 64-bit file offsets and inode numbers also in the 32-bit build: bind mounts (e.g. Docker Desktop on Windows)
# report inode numbers above 2^32, which make plain 32-bit stat()/open() fail with EOVERFLOW
ENV CFLAGS="-D_FILE_OFFSET_BITS=64" CXXFLAGS="-D_FILE_OFFSET_BITS=64"
RUN cmake -S om/engine -B b-engine -G Ninja -DCMAKE_BUILD_TYPE=Release -DCURL_SUPPORT=OFF -DGL3_RENDERER=OFF \
		-DGLES3_RENDERER=OFF -DXDG_SUPPORT=OFF -DOM_SOFPM_TESTS=OFF \
	&& cmake --build b-engine --target openMerc-ded
RUN cmake -S om/game -B b-game -G Ninja -DCMAKE_BUILD_TYPE=Release -DOM_G3_TESTS=OFF && cmake --build b-game --target gamex86
RUN cmake -S om/player -B b-player -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build b-player --target player
RUN mkdir -p /out/base && cp "$(find b-engine -name openMerc-ded -type f | head -1)" /out/ \
	&& cp "$(find b-game -name gamex86.so -type f | head -1)" "$(find b-player -name player.so -type f | head -1)" /out/base/ \
	&& cp om/LICENSE /out/openMERC-LICENSE.txt

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends zlib1g && rm -rf /var/lib/apt/lists/* \
	&& useradd --system --create-home --home-dir /home/sof sof
COPY --from=build /out/ /opt/openmerc/
COPY server/docker/server-entry.sh /usr/local/bin/server-entry.sh
USER sof
WORKDIR /home/sof
EXPOSE 27910/udp
ENTRYPOINT ["/bin/sh", "/usr/local/bin/server-entry.sh"]
