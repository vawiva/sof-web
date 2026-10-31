# Multiplayer (local network)

Browser players join a **native openMERC dedicated server** through a **WebSocket-to-UDP gateway** on the same PC.
Everything runs on your machine and LAN; nothing is published.

```
browser (WebAssembly engine)  --WSS, one message per datagram-->  gateway (/mp of the LAN host)  --UDP-->  dedicated server
```

## What was checked (2026-10-29, test PC, desktop Chrome, two independent browser clients)

| Check | Result |
| --- | --- |
| Join (console `connect` and the original Join page: Refresh → server listed → Connect) | pass; the server lists both players with pings 16-36 ms |
| See each other move | pass (one strafes, the other's view changes around that player) |
| Fire, damage, death, respawn, score | pass: 5 pistol shots, health bar 1395 → 786 red pixels before the kill, "bravo was blasted by alpha's piece" on both, respawn with full health, server frags alpha 1 / bravo 0 |
| Disconnect / reconnect | pass |
| Server map change (rcon `map dm/irqdm2`) | pass: both clients follow and stay connected |
| Wrong protocol | the server refuses protocols other than 33 at the handshake ("Server is version 1.07f.") |
| Sustained play (10 min, random movement and fire on both) | pass: no disconnect, server pings p50 16 ms / p99 35 ms, 18,250 datagrams up and 6,175 down per client, no datagram dropped, gateway WebSocket backlog never above 0 bytes, client receive queue at most 6 |
| Docker Compose setup | pass: two clients joined the composed server through the composed gateway |

Not verified: more than two players, a second physical device, the CTF/control/assassin modes, bots, long matches
with time/frag limits, any network worse than this PC's loopback/LAN. The 10-minute run produced no kill (random
movement rarely meets on a big map); kills were checked in the combat test.

## Route and alternatives

- **Engine side:** openMERC's dedicated server works with the player's 1.07f archives (verified above). openMERC speaks
  protocol 33 but, by its own documentation, its network tables differ from the original, so **original 1.07f clients
  and servers are not compatible** with openMERC ones (not tested here; that would need the original game running).
- **The server must be 32-bit.** openMERC's game and player modules read the player module's weapon objects at fixed
  32-bit offsets; a 64-bit build never fires a weapon (traced: `FireBullet` is never reached). The compose file builds
  for `linux/386` with 64-bit file offsets (bind mounts report inode numbers above 2^32).
- **Browser side:** a page cannot send UDP. The engine's datagrams for other hosts are handed to the page (engine patch
  in `backends/unix/network.c`), which sends each as one binary WebSocket message: `[IPv4][port][datagram]`
  (`src/net/gateway.ts`). Datagram boundaries stay intact; the gateway opens one UDP socket per browser connection, so
  the server sees each player as its own address (no shared source port). Emscripten's own socket emulation is not
  used, and a generic TCP WebSocket proxy (websockify) would not work: the game protocol is UDP.
- **Latency/queueing measured, not assumed:** on this PC the WebSocket leg adds p50 0.06 ms (echo), the status query
  took p50 17.19 ms through the gateway vs 16.98 ms direct UDP (the server answers once per frame). TCP head-of-line
  blocking did not show: zero backlog in the 10-minute run. Over Wi-Fi with loss, TCP would delay later datagrams behind
  a lost one; **WebRTC data channels** (unordered, unreliable) or **WebTransport datagrams** would avoid that. Neither
  is needed for these LAN results; WebTransport needs HTTP/3 with a trusted certificate, WebRTC a signalling step. They
  remain the next step if Wi-Fi tests show stalls.

## Running it

Docker Compose (needs Docker; the page must be built first: `npm run engine && npm run build`, and
`npm run lan:cert` once):

```sh
cd server
SOF_DATA="C:/GOG Games/Soldier of Fortune/base" SOF_PUBLIC_IP=192.168.1.20 SOF_BIND=192.168.1.20 docker compose up --build
```

`SOF_DATA` is mounted read-only into both containers; no game file goes into an image. `SOF_PUBLIC_IP` is the PC's LAN
address (players connect to it on port 27910; the server list shows it). `SOF_BIND` is where the page is published
(default 127.0.0.1 = this PC only), `SOF_PORT` its port (8443). The tester key is printed by `docker compose logs web`
(or fixed with `SOF_LAN_KEY`). Server options: `SOF_SERVER_ARGS` (default: deathmatch, 8 players, `dm/irqdm1`, `public
0` = no heartbeats to master servers; values cannot contain spaces). The server's UDP port is not published: only the
gateway reaches it.

Without Docker: run any openMERC 32-bit dedicated server yourself and start the LAN host with
`npm run lan -- --data "<game folder>" --mp 127.0.0.1:27910`.

Ports: TCP 8443 (page, data, gateway; LAN only, see LAN.md for the firewall rule). No UDP port has to be opened on the
PC: the gateway talks to the server inside Docker (or on localhost).

## In the game

Multiplayer → Join tab: Refresh finds the servers the gateway is configured for (the original LAN search, answered only
by those servers); select one and Connect (tested), or use Advanced to type `<PC address>:27910` (not tested yet). The **internet server list is
not available**: the browser build opens no connections to GameSpy/community master servers, so that part of the list
stays empty (nothing is invented). **Start Server** in the browser starts a game that only the local player can join (a
browser cannot accept incoming connections); host games with the dedicated server instead. The GameSpy chat tab has no
connection either.

## Gateway restrictions (server/mp-gateway.mjs)

Only configured servers (`--mp host:port[=alias-ip:port]`); datagrams to any other address are dropped and connections
that keep trying are closed; the LAN search is forwarded only as connectionless `info`/`status`/`ping` queries and only
to configured servers; at most 1,464 bytes per datagram; per connection 400 datagrams/s and 256 KB/s (token buckets);
server-to-browser datagrams are dropped (as UDP would) while the browser's WebSocket backlog exceeds 256 KB; at most 32
connections; the WebSocket upgrade requires a LAN client address, the tester cookie and a same-origin `Origin`
(a page on another site cannot use a player's browser to reach it). Not an internet service: for a later HTTPS/WSS
deployment the gateway would additionally need real authentication, per-account limits, TLS with a public certificate,
and abuse monitoring; none of that is provided or intended now.

## Known problems

- Clients log `Ghoul: missing delta base <n> for instance <m>` now and then (Ghoul model delta compression); no visible
  effect was seen in the tests.
- openMERC lists its bots, team objectives and several modes as untested in game (upstream `docs/KNOWN_ISSUES.md`).
