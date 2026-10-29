#!/usr/bin/env node
// LAN host mode: serves the built page (dist/) and the player's own game archives from this PC to devices on the
// same local network, so a phone can run the game in its browser without copying the installation.
//
// Restrictions (by design):
//  - only the five required archives are served, under fixed virtual names (/gamedata/pak0.pak ...); the data folder
//    is opened read-only, nothing else in it is reachable, and there are no directory listings
//  - static files come only from the build directory; paths are normalized and checked against it
//  - every request needs the tester key (from the printed URL; kept in an HttpOnly cookie afterwards)
//  - clients must have a loopback or private-network address (no public addresses, no port forwarding)
//  - GET and HEAD only; single byte ranges only
//
// usage: node server/lan-host.mjs --data "<Soldier of Fortune folder>" [--port 8443] [--http] [--bind 0.0.0.0]
//        [--cert server/certs] [--key <tester key>] [--dist dist] [--mp host:port[=alias-ip:port] ...]
// --mp enables the multiplayer gateway (/mp, mp-gateway.mjs) for that game server; repeatable.
// Without --http it serves HTTPS with server/certs/server.crt and server.key (see docs/LAN.md and make-cert.sh).
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, parseServerSpec } from './mp-gateway.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = ['pak0.pak', 'pak1.pak', 'pak2.pak', 'pak3.pak', 'gs.pak'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm', '.so': 'application/octet-stream', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function args(argv) {
  const o = { port: 8443, bind: '0.0.0.0', http: false, cert: path.join(ROOT, 'server', 'certs'), dist: path.join(ROOT, 'dist'), mp: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--data') o.data = next();
    else if (a === '--port') o.port = Number(next());
    else if (a === '--bind') o.bind = next();
    else if (a === '--http') o.http = true;
    else if (a === '--cert') o.cert = next();
    else if (a === '--key') o.key = next();
    else if (a === '--dist') o.dist = path.resolve(next());
    else if (a === '--mp') o.mp.push(next());
    else throw new Error(`unknown option ${a}`);
  }
  if (!o.data) throw new Error('--data "<Soldier of Fortune folder>" is required');
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error('--port must be 1-65535');
  o.key ??= process.env.SOF_LAN_KEY || crypto.randomBytes(12).toString('base64url');
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(o.key)) throw new Error('the tester key must be 12-64 characters of A-Z a-z 0-9 _ -');
  return o;
}

/** The five archives in <data> or its "base" folder (any capitalization); duplicates and gaps are reported. */
export function findArchives(dataDir) {
  const dirs = [dataDir];
  try {
    for (const e of fs.readdirSync(dataDir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.toLowerCase() === 'base') dirs.push(path.join(dataDir, e.name));
    }
  } catch {
    return { found: new Map(), problems: [`the data folder cannot be read`] };
  }
  const seen = new Map();
  for (const dir of dirs) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const lower = e.name.toLowerCase();
      if (e.isFile() && REQUIRED.includes(lower)) seen.set(lower, [...(seen.get(lower) ?? []), path.join(dir, e.name)]);
    }
  }
  const found = new Map();
  const problems = [];
  for (const n of REQUIRED) {
    const list = seen.get(n) ?? [];
    if (list.length === 1) found.set(n, list[0]);
    else problems.push(list.length ? `${n} exists more than once` : `${n} not found`);
  }
  return { found, problems };
}

/** Loopback or private-network client address (IPv4, IPv6 ULA/link-local, IPv4-mapped). */
export function isLanAddress(addr) {
  const a = (addr ?? '').replace(/^::ffff:/, '');
  if (a === '::1' || /^127\./.test(a) || /^10\./.test(a) || /^192\.168\./.test(a)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^169\.254\./.test(a)) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a);
}

/** Parses a single "bytes=a-b" range against `size`; null = whole file, 'bad' = not satisfiable. */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'bad';
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || start > end || start >= size) return 'bad';
  return { start, end };
}

/** Maps a URL path onto a file inside `root`, or null (traversal, hidden files, directories). */
export function staticPath(root, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  if (p.includes('\0') || p.includes('\\')) return null;
  if (p.endsWith('/')) p += 'index.html';
  const parts = p.split('/').filter(Boolean);
  if (parts.some((s) => s === '..' || s.startsWith('.'))) return null;
  const full = path.resolve(root, ...parts);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function lanUrls(port, scheme, key) {
  // in a container the interfaces are the container's own: the configured LAN address is the one to use
  if (process.env.SOF_PUBLIC_IP) return [`${scheme}://${process.env.SOF_PUBLIC_IP}:<published port>/?key=${key}`];
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) {
      // virtual adapters (WSL, Hyper-V, VPNs) are listed too; the phone needs the Wi-Fi / Ethernet one
      if (i.family === 'IPv4' && !i.internal && isLanAddress(i.address)) out.push(`${scheme}://${i.address}:${port}/?key=${key}   [${name}]`);
    }
  }
  return out;
}

export function createHandler({ dist, archives, key, secure, caCert = null, log = () => {} }) {
  const sizes = new Map([...archives].map(([n, f]) => [n, fs.statSync(f)]));
  const cookie = `sof_key=${key}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  const send = (res, status, text, headers = {}) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
    res.end(text);
  };
  const keyOk = (k) => typeof k === 'string' && k.length === key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(key));
  const cookieKey = (req) => /(?:^|;\s*)sof_key=([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? '')?.[1];
  const handler = (req, res) => {
    const common = {
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
      'x-frame-options': 'DENY',
    };
    for (const [h, v] of Object.entries(common)) res.setHeader(h, v);
    if (!isLanAddress(req.socket.remoteAddress)) return send(res, 403, 'LAN clients only.\n');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed.\n', { allow: 'GET, HEAD' });
    let url;
    try { url = new URL(req.url ?? '/', 'http://lan'); } catch { return send(res, 400, 'Bad request.\n'); }
    const given = url.searchParams.get('key');
    if (keyOk(given)) {
      // keep the key out of later URLs: set the cookie and redirect to the clean address
      url.searchParams.delete('key');
      return send(res, 303, 'Signed in.\n', { location: url.pathname + url.search, 'set-cookie': cookie });
    }
    if (!keyOk(cookieKey(req))) return send(res, 403, 'This page needs the tester link printed by the PC that hosts it.\n');

    // the local CA's public certificate (never its key), for installing it on a test device
    if (url.pathname === '/lan/ca.crt' && caCert) {
      return send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(caCert), {
        'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="sof-lan-ca.crt"',
      });
    }
    if (url.pathname === '/gamedata/manifest.json') {
      const body = JSON.stringify({ version: 1, files: REQUIRED.map((name) => ({ name, size: sizes.get(name).size })) });
      return send(res, 200, req.method === 'HEAD' ? '' : body, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    }
    const gm = /^\/gamedata\/([a-z0-9]+\.pak)$/.exec(url.pathname);
    if (gm) {
      const name = gm[1];
      if (!archives.has(name)) return send(res, 404, 'Not found.\n');
      const st = sizes.get(name);
      const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      const range = parseRange(req.headers.range, st.size);
      if (range === 'bad') return send(res, 416, 'Range not satisfiable.\n', { 'content-range': `bytes */${st.size}` });
      const headers = {
        'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', etag,
        // archives do not change while the server runs; the browser may keep pieces for a while
        'cache-control': 'private, max-age=3600',
      };
      const { start, end } = range ?? { start: 0, end: st.size - 1 };
      headers['content-length'] = String(end - start + 1);
      if (range) headers['content-range'] = `bytes ${start}-${end}/${st.size}`;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD') return res.end();
      log(`${req.socket.remoteAddress} ${name} ${start}-${end}`);
      const stream = fs.createReadStream(archives.get(name), { start, end, flags: 'r' });
      stream.on('error', () => res.destroy());
      return stream.pipe(res);
    }
    if (url.pathname.startsWith('/gamedata/')) return send(res, 404, 'Not found.\n');

    const file = staticPath(dist, url.pathname);
    let st;
    try { st = file && fs.statSync(file); } catch { st = null; }
    if (!file || !st?.isFile()) return send(res, 404, 'Not found.\n');
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(st.size), 'cache-control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  };
  /** WebSocket upgrades (multiplayer gateway): LAN client, tester cookie and a same-origin page only. */
  handler.upgradeAllowed = (req) => {
    if (!isLanAddress(req.socket.remoteAddress) || !keyOk(cookieKey(req))) return false;
    let u;
    try { u = new URL(req.url ?? '/', 'http://lan'); } catch { return false; }
    const host = req.headers.host ?? '';
    return u.pathname === '/mp' && (req.headers.origin === `https://${host}` || req.headers.origin === `http://${host}`);
  };
  return handler;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let o;
  try { o = args(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(2); }
  const { found, problems } = findArchives(o.data);
  if (problems.length) { console.error(`Game data: ${problems.join('; ')}`); process.exit(1); }
  if (!fs.existsSync(path.join(o.dist, 'index.html'))) { console.error(`No build in ${o.dist}: run "npm run build" first.`); process.exit(1); }
  const caCert = path.join(o.cert, 'ca.crt');
  const handler = createHandler({ dist: o.dist, archives: found, key: o.key, secure: !o.http,
    caCert: fs.existsSync(caCert) ? caCert : null,
    log: process.env.SOF_LAN_VERBOSE ? (l) => console.log(l) : undefined });
  let server;
  if (o.http) server = http.createServer(handler);
  else {
    const crt = path.join(o.cert, 'server.crt');
    const keyFile = path.join(o.cert, 'server.key');
    if (!fs.existsSync(crt) || !fs.existsSync(keyFile)) {
      console.error(`HTTPS needs ${crt} and ${keyFile} (create them with server/make-cert.sh, see docs/LAN.md), or use --http.`);
      process.exit(1);
    }
    server = https.createServer({ cert: fs.readFileSync(crt), key: fs.readFileSync(keyFile) }, handler);
  }
  if (o.mp.length) {
    // the addresses players use for a server: this PC's LAN addresses and localhost, unless an alias is given
    const own = [...Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal && isLanAddress(i.address)).map((i) => i.address), '127.0.0.1'];
    if (process.env.SOF_PUBLIC_IP) own.unshift(process.env.SOF_PUBLIC_IP);
    let servers;
    try { servers = o.mp.map((spec) => parseServerSpec(spec, own)); } catch (err) { console.error(err.message); process.exit(2); }
    const gateway = createGateway({ servers, log: (l) => console.log(l) });
    server.on('upgrade', (req, socket, head) => {
      if (!handler.upgradeAllowed(req)) {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      gateway.handleUpgrade(req, socket, head);
    });
    for (const s of servers) console.log(`Multiplayer gateway: ${s.aliasIps[0]}:${s.aliasPort} -> ${s.host}:${s.port} (UDP)`);
  } else {
    server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 404 Not Found\r\n\r\n'));
  }
  server.listen(o.port, o.bind, () => {
    const scheme = o.http ? 'http' : 'https';
    console.log(`Soldier of Fortune LAN host: ${found.size} archives served read-only from the configured folder.`);
    console.log(`Open on a device in this network (the key admits testers; do not share it outside):`);
    for (const u of lanUrls(o.port, scheme, o.key)) console.log(`  ${u}`);
    console.log(`  ${scheme}://localhost:${o.port}/?key=${o.key}   (this PC)`);
    if (!o.http) console.log(`Test device certificate (install once, see docs/LAN.md): <address>/lan/ca.crt after opening a link above`);
    console.log('Stop with Ctrl+C.');
  });
}
