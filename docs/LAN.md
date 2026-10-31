# LAN host mode (play on a phone with the game files on your PC)

The PC serves the web page and **its own installed game files** to devices in the same local network. The phone
runs the game in its browser (WebAssembly; nothing is streamed as video) and reads the archives from the PC on
demand. Nothing is copied onto the phone permanently and no file is selected there. Saves and settings stay in the
phone's browser (export/import on the startup page); the PC's own Soldier of Fortune saves are never touched.

The normal mode (select the files on the device itself) is unchanged and still works without the PC. To play without
the PC later, the phone can **download and keep** the game once (startup page → Keep the game on this device; see
[INSTALL_ON_DEVICE.md](INSTALL_ON_DEVICE.md)); it then starts without pairing, file selection or network.

## Start

```sh
npm ci
npm run engine        # once, or after engine changes (needs the Emscripten SDK, see BUILD.md)
npm run build
npm run lan:cert      # once: creates server/certs/ (local CA + certificate for this PC's LAN addresses)
npm run lan -- --data "C:\GOG Games\Soldier of Fortune"
```

The server prints one URL per network adapter, for example `https://192.168.1.20:8443/?key=…   [Ethernet]`. Use the one
of the adapter that is on your Wi-Fi/Ethernet network (adapters named vEthernet/WSL/VPN are virtual). The `key`
admits a tester: the first visit swaps it for a cookie, so it does not stay in the address bar. A new random key is
made at every start; `--key <12-64 chars>` or `SOF_LAN_KEY` keeps one fixed. Options: `--port` (8443), `--bind`
(0.0.0.0; use the LAN address to listen on one adapter only), `--http` (plain HTTP, see below), `--dist`, `--cert`.

The server also prints a six-digit **pairing code** for the installed app (below). Keep the key and the code to
yourself: anyone on the network with either can use your copy. Do not paste the key into bug reports; the page's
input report removes it automatically.

### Installed app (Home Screen) and pairing

Phones and tablets play from the installed web app; the browser tab is for setup, help and installing it (see the
startup page). On iPhone/iPad: open the tester link in **Safari** → Share → **Add to Home Screen** (keep "Open as Web
App" on if offered) → open **Soldier of Fortune Web** from the Home Screen. On Android: the page's **Install app**
button or the browser menu → Install app.

- The installed app opens the address it was added from, **without the key**, and keeps its own cookies and storage
  (on iOS separate from Safari). Its first start therefore shows **Pair this device**: type the pairing code printed by
  the LAN host (or the whole key). The device then stays paired for 30 days, or until the key changes.
- With the default random key, every restart of the LAN host unpairs all devices (and the code changes). To keep
  devices paired across restarts, start the host with a fixed key, e.g. `SOF_LAN_KEY=<your own 12-64 characters>`.
- Ten wrong codes block pairing until the host restarts (the tester link keeps working).
- An installed app is bound to its address. If the PC's LAN address changes, open the new link in Safari and add the
  app again (or give the PC a fixed address in the router's DHCP settings).
- Saves and settings of the installed app are separate from Safari's on iOS. To move them: Safari tab → Saves and
  storage → Export; installed app → Import. Nothing is transferred automatically.
- The installed app keeps only the startup page (no game data, no engine) for opening while the PC is off; it then
  says the PC is not reachable. There is no offline play.
- The app icon of paired devices is made at run time from your installed `SoF.exe` (never stored or included in the
  project); unpaired devices and the project itself use a neutral sight icon.

## What the server allows

| Allowed | Refused |
| --- | --- |
| the built page (`dist/`) | any other file, directory listings, paths with `..`, hidden files, encoded traversal |
| `pak0.pak`, `pak1.pak`, `pak2.pak`, `pak3.pak`, `gs.pak` under `/gamedata/` (single byte ranges, read-only) | every other file of the game folder (executables, configs, saves) |
| `/gamedata/manifest.json`: names and sizes only, no paths | requests without the tester key/cookie (403; page loads get the pairing page) |
| without a key: `/lan/pair` (pairing page and form), `/manifest.webmanifest`, the neutral icons under `/icons/` | POST anywhere but `/lan/pair`; pairing after 10 wrong codes (429) |
| `/icons/*.png` for paired devices: made from `SoF.exe` in the data folder at run time | |
| `/lan/status.json`: the multiplayer servers the gateway forwards to (join addresses only), for the startup page |  |
| `/lan/ca.crt`: the local CA's public certificate | clients with a public IP address (403); methods other than GET/HEAD (405) |

The game folder is located with `--data` (the folder itself or its `base` folder, any capitalization; duplicates are
refused). It is only opened for reading. Tests: `tests/lan-host.test.ts`.

**LAN only.** Do not forward the port on your router, do not expose it to the internet and do not run it on a
network you do not trust: anyone with the link and access to the network can play your copy.

## Windows Firewall (run once, as administrator)

Windows blocks incoming connections by default. On this PC the Ethernet connection is in the **Public** profile.
If this is your home network, mark it private and allow only this port from the local subnet:

```powershell
# only if this is your own home network
Set-NetConnectionProfile -InterfaceAlias "Ethernet" -NetworkCategory Private
New-NetFirewallRule -DisplayName "SoF LAN host 8443 (testing)" -Direction Inbound -Action Allow -Protocol TCP `
  -LocalPort 8443 -Profile Private -RemoteAddress LocalSubnet
# remove it after testing
Remove-NetFirewallRule -DisplayName "SoF LAN host 8443 (testing)"
```

Do not turn the firewall off. If Windows shows an "allow Node.js" prompt when the server starts, allow it for
private networks only. No router changes are needed or wanted.

## HTTPS and the test device

Plain HTTP on a LAN address is not a *secure context*. WebAssembly, WebGL 2, Web Audio, IndexedDB, Fullscreen and
Pointer Lock work there, but the Gamepad API, Keyboard Lock (Esc in fullscreen), Screen Wake Lock and service workers
are limited to secure contexts (MDN, "Features restricted to secure contexts"). The default is therefore HTTPS with a
certificate from your own local CA. `--http` remains for a quick check without certificates.

Install the CA once on the phone (open a tester link first, accept the browser warning once, then):

- **Android (Chrome):** open `https://<PC address>:8443/lan/ca.crt` and download it, then Settings → Security (or
  Security & privacy) → More security settings → Encryption & credentials → Install a certificate → CA certificate →
  pick `sof-lan-ca.crt`. Chrome on Android trusts user-installed CAs.
- **iPhone/iPad (Safari):** open the same address, allow the profile download, then Settings → Profile Downloaded →
  Install, and Settings → General → About → Certificate Trust Settings → enable full trust for "SoF browser port
  local test CA".

Remove the certificate after testing (Android: Trusted credentials → User; iOS: Settings → General → VPN & Device
Management). `server/certs/ca.key` must never leave the PC; delete `server/certs/` to retire everything.

## Cost on the phone (measured on the PC, desktop Chrome)

Archives are streamed through a 48 MB block cache instead of being copied into memory. Browser renderer process peak
after loading tsr1 and nyc1: 1,315 MB with the full copy, 612 MB streamed with a 96 MB cache, 560 MB with 48 MB (the
default); the GPU process adds about 450 MB. About 180-215 MB of the 785 MB were transferred for those two levels.
Level loads take about 1 s longer than with the copy on a local disk. Of the remaining renderer memory, the engine's
WebAssembly heap is 150 MB, decoded sound about 60 MB, the cache 48 MB; the rest is compiled code, graphics buffers and
the browser itself. Phones with little memory may still close the tab. These figures are from the PC; phone results
are pending a real device.

Streaming uses synchronous byte-range requests on the page's main thread. Chrome supports this (verified on the PC,
including `blob:` URLs of local files); other browsers are not verified yet, and the page falls back to the full copy
when a browser refuses them.

## Phone checklist: MCON and Home Screen (physical device; report results back)

Start the host on the PC (restart it after updating, so the pairing page and icon are active):
`npm run build` once after updates, then `npm run lan -- --data "C:\GOG Games\Soldier of Fortune"` (add `--mp ...` for
multiplayer). Open the printed `https://<PC address>:8443/?key=…` link for your Wi-Fi adapter in **Safari**.

1. **Safari tab:** the page shows "Ready: Platinum Edition 1.07f … served by your PC" and the **Install the app** steps
   instead of Play. Settings → Input diagnostics: connect the MCON, press one button, then **Copy report** and send it
   (the key is removed automatically).
2. **Install:** Share → Add to Home Screen (keep "Open as Web App" on) → Add. The Home Screen icon should be the game's.
3. **Installed app:** open it from the Home Screen. Expect **Pair this device**: enter the pairing code from the PC's
   host window. The page then shows Ready without install steps and without a file picker.
4. **Controller before launch:** with the MCON already connected, press a button, check Input diagnostics, then Play
   (sideways). In the game: left stick moves, right stick looks, right trigger fires, A jumps, B crouches, shoulders
   switch weapons, Start opens the menu, A selects, B goes back. The touch controls should disappear once the MCON's
   input reaches the game.
5. **Controller during play:** turn the MCON off and on (or reconnect): the game pauses on disconnect and the touch
   controls come back; after reconnecting press a button, resume from the menu, and play on.
6. **Other app and back:** switch to another app and return: the game asks for a tap to resume; the MCON still works.
7. **Saving:** save in the game menu, Quit in the main menu (returns to the start page), Play again, load.
8. **Report:** after quitting, Settings → Input diagnostics → **Copy report** again and send it; it includes the last
   game session ("Verdict: …" says where controller input stopped, if it did).
9. **Memory stability:** 10-15 minutes including one level change; note any reload or crash.

## Retest: train enemies and aiming speed

Rebuild and restart the host first (`npm run build`, then `npm run lan -- --data "…"`); the installed app picks up the
new page on its next start.

1. **Aiming notice:** on the start page, if "Updated recommended controls" appears, choose **Apply** (or Keep).
   Settings → Controller shows 330 °/s, 220 °/s, dead zone 0.12, curve balanced, turn boost off.
2. **tsr1 train enemies:** play from the start of tsr1 to the subway train. When it leaves with the three skinheads on
   its roof, follow it to the stop point and stay in view: they should aim and shoot at you and can hurt you (from far
   away most shots miss, as the game's hit model intends). Note if they only stand or stretch.
3. **Touch turn speed:** without the controller, a swipe across about a quarter of the screen width should turn about
   100°; a full-width swipe about 420°. Fine aiming with short swipes should still be controllable.
4. **MCON turn speed:** full right stick should turn 180° in about 0.6 s; half deflection about 100 °/s, slight
   deflection slow for fine aim. Try the curve setting (linear / balanced / precise) and Turn boost if wanted.
5. Tell me which speeds feel right (or the slider values you settle on).

Android: installing is offered on the start page (Install app / browser menu), with **Continue in browser**; both play
with the PC's data (browser tab tested with an Android user agent on the PC; installed Android app not tested). Whether
the installed app and the browser tab share saves on Android was not tested; use Export/Import if they do not.

## Phone test: ending skip, keeping the game, offline

The host serves the new build after `npm run build` (no restart needed); the installed app picks it up on its next
start (it may need one more start, while the new version is downloaded in the background).

1. **Last session notice:** if the start page says "The last game session did not end normally", tap **Copy report**
   and send me the text (access keys are removed automatically). It appears only after a session that stopped badly.
2. **Old saves:** saves made before this update load, but the level's triggers and relays do not work after loading
   them (the bug found in this round; e.g. tsr1's ending never starts). Start a new game (Game → Start Game) for the
   retest; saves made from now on keep the level working.
3. **Ending skip:** play tsr1 to its end normally. When the end cinematic starts, skip it with the touch **Menu** button
   or the MCON's Start (also try tapping it several times). Expected: a short "mission accomplished" screen, the tsr2
   briefing cinematic (skippable the same way), then trn1 starts and can be played; no main menu should pop up on its
   own. If it hangs, wait 20 s, then close the app and reopen it: the start page should show the session report.
4. **Keep the game:** start page → Keep the game on this device → **Download and keep the game from my PC** (about
   785 MB; keep the app open and the screen on). Expected: progress, then "Stored on this device" and the status line
   "Ready on this device". Note the time it took.
5. **Offline:** play, save in the game, quit to the start page and close the app. Turn on Airplane Mode (or stop the
   LAN host), reopen the app from the Home Screen: it should open, show "Ready on this device", play and load the save.
6. **Storage line:** Storage on this device shows how much the site uses and whether it is kept persistently. Tell me
   what it says.
7. **Optional, on the phone itself:** Import game files or disc image… with the GOG installer `.exe` or the five
   `.pak` files from the Files app (only if you have them on the phone).

## Retest: tsr1 ending freeze (desktop Chrome, CD image stored in the browser)

Status: reproduced by the user, not reproduced in automated tests, fix not physically verified.

1. Start the LAN host as usual and open the app in Chrome on the PC. Before pressing Play, open **Browser
   settings → Game session reports**. "Running versions" should end in "(same as this page)"; if it says
   "DIFFERENT", close and reopen the tab once.
2. Still before Play: press **Copy reports** and send the text. If you have not played since the freeze, the failing
   session may still be listed (older builds recorded less, but the stage and Esc presses are there).
3. New Game, play tsr1 to the train stop as before. When the last skinhead dies and the screen fades, press Esc once.
   Note whether the mouse was captured (no cursor visible) at that moment.
4. If the picture freezes again, wait 2 minutes without pressing anything (the app then marks the session as stuck),
   then press Esc once more and note what happens. Then reload the page and **Copy reports** again.
5. If it does not freeze: it should go through the "mission accomplished" screen and the briefing to the train level.
