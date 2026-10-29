#!/bin/sh
# Starts the openMERC dedicated server with the player's own archives, mounted read-only at /data (the installation
# folder or its base folder). The game folder is assembled from links in the container's home; nothing is copied
# and nothing in /data is written.
set -eu
game=/home/sof/game
mkdir -p "$game/base"
for name in pak0.pak pak1.pak pak2.pak pak3.pak gs.pak; do
	src=$(find /data -maxdepth 2 -type f -iname "$name" | head -n 2)
	count=$(printf '%s\n' "$src" | grep -c . || true)
	if [ "$count" -ne 1 ]; then
		echo "server-entry: $name must exist exactly once in /data (found $count)" >&2
		exit 1
	fi
	ln -sf "$src" "$game/base/$name"
done
ln -sf /opt/openmerc/base/gamex86.so "$game/base/gamex86.so"
ln -sf /opt/openmerc/base/player.so "$game/base/player.so"
cd "$game"
# SOF_SERVER_ARGS: engine arguments, e.g. +set deathmatch 1 +set maxclients 8 +map dm/irqdm1 (see compose.yaml);
# they are split at spaces, so values cannot contain spaces (use LAN-test, not "LAN test")
# shellcheck disable=SC2086
exec /opt/openmerc/openMerc-ded -basedir "$game" ${SOF_SERVER_ARGS:-+set dedicated 1 +set deathmatch 1 +set maxclients 8 +map dm/irqdm1}
