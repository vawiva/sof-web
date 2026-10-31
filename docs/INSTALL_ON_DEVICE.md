# Keeping the game on a device and playing offline

The startup page can keep the game data in the browser's private storage for this site (the origin-private file
system, OPFS). Once the data is stored, the game starts without a file picker, without pairing and without the PC,
and the installed app keeps working with the network off (single-player).

## Sources

Under **Keep the game on this device**:

| Source | What happens |
| --- | --- |
| The selected files ("Keep the selected files on this device") or **Import game files or disc image…** with the five archives | `pak0.pak`–`pak3.pak` and `gs.pak` are copied in 4 MB pieces |
| **Download and keep the game from my PC** (LAN host mode, paired) | the same archives are downloaded with byte ranges from the PC; an interrupted download continues where it stopped |
| The 2001 Platinum CD image (`.iso`) | the disc's InstallShield 5 set (`Setup/data1.hdr`, `data1.cab`) is read and only `base/*.pak` are unpacked (zlib, checked against the cabinet's MD5 of each file) |
| The GOG installer (`setup_soldier_of_fortune_1.07f_hotfix_(54919).exe`, Inno Setup 5.6.2, one file) | the installer is read as an archive, nothing of it runs: GOG stores each archive as numbered zlib pieces with the MD5 of every piece and of the whole file; the pieces are unpacked and joined, and the MD5 of the result must match |

Other formats are rejected with the reason (other Inno Setup versions, installers with separate `.bin` files,
encrypted or Inno-compressed data, other InstallShield versions, multi-disc sets, BIN/CUE and other image formats).
Nothing is uploaded; the installer and disc readers are this project's own code (`src/files/`), see
[THIRD_PARTY_NOTICES](../public/THIRD_PARTY_NOTICES.md) for the formats' references.

### Which files are kept

Only the five archives (about 785 MB). The browser port runs its own engine and game modules, so the Windows
programs (`SoF.exe`, `gamex86.dll`, `player.dll`, `ref_gl.dll` and the sound DLLs), documentation, DirectX and
installer files are not needed and are not kept. Evidence: the engine's file opens during boot, the menus and loading
every campaign map and the tutorial (test `fs-trace`, see STATUS.md) go only to these archives, the engine's own
modules and the profile folder.

Editions recognised: GOG Platinum 1.07f and the 2001 Platinum CD. The CD's archives are the same as GOG's except
`menus/b_lock.rmf` (the parental-lock button, which GOG emptied); its game module is identical to GOG's 1.07f.

## Safety of the stored copy

- Writes happen in a worker with synchronous access handles; memory use stays at a few MB per piece (installer
  pieces: up to 8 MB packed + 8 MB unpacked).
- Every archive is read back from storage and hashed after writing; only verified archives are recorded.
- `install.json` is written last, after the archives were validated (PACK directories, campaign maps, edition). Without
  it the data is never offered for play: an interrupted or failed import shows as *interrupted* with its size, offers
  **Resume** (while the page still has the source; downloads from the PC can always resume) and **Remove**.
- Space: the page compares the space still needed with `navigator.storage.estimate()` before starting (with a 32 MB
  margin) and asks for persistent storage (`navigator.storage.persist()`); a refusal is shown, since the browser may
  then clear the data when the device runs low on space.
- **Verify stored game data** re-reads everything; a missing archive or one with the wrong size is noticed at every
  start, a changed byte by Verify. Repair = import again (or download again from the PC).
- **Remove game data** deletes only the stored archives. Saves and settings are kept in a different store (IndexedDB)
  and stay.

Storage is not memory: the game still reads the stored archives in pieces through the same 48 MB cache as before;
nothing is loaded whole into memory.

## Offline application

The service worker (`pwa/sw.template.js`, written into the build with its file list) keeps one complete version of
the application: page, scripts, styles, icons, manifest and the engine (WebAssembly and its modules, about 7 MB). A new
version is downloaded completely before it replaces the old one; the engine is requested with `?v=<hash>`, so a page
never mixes engine and page from different versions. Game data, the LAN host's endpoints and multiplayer are never
cached. Opening the app tries the network for up to 3.5 s and then uses the stored version.

## Addresses keep separate storage

Browser storage belongs to one address (origin). The LAN address (for example `https://<PC address>:8443`), a changed
LAN address and a later public website each have their own storage, saves and installed app. A new address cannot read
another address's storage. To move:

1. On the old address: **Saves and storage → Export saves**.
2. On the new address: install the app, **Import saves**, then keep the game there again (import the files/installer
   on the device, or download from the PC while that is reachable from the new address).

## Downloading from the PC into a public website (not verified)

A page on a public HTTPS site fetching from `https://<PC LAN address>` is a cross-origin request to a private
address. It would need: a certificate the device trusts for the PC's address; CORS headers on the LAN host for that
site; credentials that are not cookies (Safari blocks third-party cookies); and the browsers' local-network rules
(Chrome's Local Network Access permission; Safari's behaviour is not established here). None of this is implemented or
tested. Importing the files, the CD image or the GOG installer on the device works on any address and is the
fallback.

## Measured (Chrome on the test PC, Playwright)

| Step | Result |
| --- | --- |
| Import of the five archives from disk | 13–17 s including a cancel and resume |
| Download from the loopback LAN host | 21 s |
| CD image: unpack the five archives (Node, same code) | 26 s, process memory about 130 MB |
| GOG installer: unpack `pak0.pak` (84 pieces) | 16.8 s, process memory about 150 MB |
| Read-back MD5 | about 100 MB/s in JavaScript |

Phones are slower; physical-device results are pending.
