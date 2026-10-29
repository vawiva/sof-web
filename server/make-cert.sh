#!/usr/bin/env bash
# Creates a private certificate authority (once) and an HTTPS certificate for this PC's LAN addresses, for the
# LAN host (server/lan-host.mjs). Output: server/certs/ (ignored by git; never commit or share ca.key).
#   ca.crt     - install and trust this on the test phone (see docs/LAN.md)
#   server.crt / server.key - used by the LAN host
# usage: bash server/make-cert.sh [extra IP or host name ...]
# Requires openssl (Git for Windows, macOS and Linux include it). Re-run when the PC's LAN address changes.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows would rewrite the /CN=... subjects into paths
DIR=$(cd "$(dirname "$0")" && pwd)/certs
mkdir -p "$DIR"
cd "$DIR"

if [ ! -f ca.key ] || [ ! -f ca.crt ]; then
	openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 825 -sha256 \
		-subj "/CN=SoF browser port local test CA ($(hostname))" \
		-addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign"
	echo "created certs/ca.crt (install it on the test device)"
fi

# this PC's private IPv4 addresses, plus names and anything given on the command line
ips=$(node -e '
const os = require("os");
const lan = (a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) if (i.family === "IPv4" && !i.internal && lan(i.address)) console.log(i.address);')
san="DNS:localhost,IP:127.0.0.1,DNS:$(hostname)"
for ip in $ips; do san="$san,IP:$ip"; done
for extra in "$@"; do
	if [[ $extra =~ ^[0-9.]+$ ]]; then san="$san,IP:$extra"; else san="$san,DNS:$extra"; fi
done

openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=$(hostname) SoF LAN host"
printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$san" > server.ext
# 397 days: the longest validity Apple devices accept for a server certificate
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 397 -sha256 -extfile server.ext
rm -f server.csr server.ext
echo "created certs/server.crt for: $san"
