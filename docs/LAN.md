# LAN host mode (play on a phone with the game files on your PC)

The PC serves the web page and **its own installed game files** to devices in the same local network. The phone
runs the game in its browser (WebAssembly; nothing is streamed as video) and reads the archives from the PC on
demand. Nothing is copied onto the phone permanently and no file is selected there. Saves and settings stay in the
phone's browser (export/import on the startup page); the PC's own Soldier of Fortune saves are never touched.

The normal mode (select the files on the device itself) is unchanged and still works without the PC.

## Start

```sh
npm ci
npm run engine        # once, or after engine changes (needs the Emscripten SDK, see BUILD.md)
npm run build
npm run lan:cert      # once: creates server/certs/ (local CA + certificate for this PC's LAN addresses)
npm run lan -- --data "C:\GOG Games\Soldier of Fortune"
```

The server prints one URL per network adapter, for example `https://10.0.1.3:8443/?key=…   [Ethernet]`. Use the one
of the adapter that is on your Wi-Fi/Ethernet network (adapters named vEthernet/WSL/VPN are virtual). The `key`
admits a tester: the first visit swaps it for a cookie, so it does not stay in the address bar. A new random key is
made at every start; `--key <12-64 chars>` or `SOF_LAN_KEY` keeps one fixed. Options: `--port` (8443), `--bind`
(0.0.0.0; use the LAN address to listen on one adapter only), `--http` (plain HTTP, see below), `--dist`, `--cert`.

## What the server allows

| Allowed | Refused |
| --- | --- |
| the built page (`dist/`) | any other file, directory listings, paths with `..`, hidden files, encoded traversal |
| `pak0.pak`, `pak1.pak`, `pak2.pak`, `pak3.pak`, `gs.pak` under `/gamedata/` (single byte ranges, read-only) | every other file of the game folder (executables, configs, saves) |
| `/gamedata/manifest.json`: names and sizes only, no paths | requests without the tester key/cookie (403) |
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
