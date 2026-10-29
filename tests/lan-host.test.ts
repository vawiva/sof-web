/// <reference types="node" />
// Security and protocol tests for the LAN host (synthetic archives in a temporary folder; no game data).
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without type declarations
import { createHandler, findArchives, isLanAddress, parseRange, staticPath } from '../server/lan-host.mjs';

const KEY = 'test-key-123456';
let tmp: string;
let server: http.Server;
let base: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sof-lan-'));
  fs.mkdirSync(path.join(tmp, 'install', 'Base'), { recursive: true });
  for (const n of ['PAK0.PAK', 'pak1.pak', 'pak2.pak', 'pak3.pak', 'gs.pak']) {
    fs.writeFileSync(path.join(tmp, 'install', 'Base', n), Buffer.from(`PACK-${n.toLowerCase()}-0123456789`));
  }
  fs.writeFileSync(path.join(tmp, 'install', 'Base', 'config.cfg'), 'private');
  fs.mkdirSync(path.join(tmp, 'dist', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'dist', 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'a.js'), 'x');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'outside');
  const { found } = findArchives(path.join(tmp, 'install'));
  server = http.createServer(createHandler({ dist: path.join(tmp, 'dist'), archives: found, key: KEY, secure: false }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const get = (p: string, headers: Record<string, string> = {}) =>
  fetch(base + p, { headers: { cookie: `sof_key=${KEY}`, ...headers }, redirect: 'manual' });

describe('helpers', () => {
  it('accepts only loopback and private-network clients', () => {
    for (const a of ['127.0.0.1', '::1', '192.168.1.20', '10.0.0.5', '172.20.1.1', '::ffff:192.168.0.9', 'fd12:3456::1', 'fe80::1']) {
      expect(isLanAddress(a)).toBe(true);
    }
    for (const a of ['8.8.8.8', '172.32.0.1', '::ffff:1.2.3.4', '2001:db8::1', '', undefined]) expect(isLanAddress(a)).toBe(false);
  });
  it('parses single byte ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=0-1000', 100)).toEqual({ start: 0, end: 99 });
    for (const r of ['bytes=100-', 'bytes=5-1', 'bytes=0-1,4-5', 'items=0-1', 'bytes=-']) expect(parseRange(r, 100)).toBe('bad');
  });
  it('keeps static paths inside the build folder', () => {
    const root = path.resolve('/srv/dist');
    expect(staticPath(root, '/')).toBe(path.join(root, 'index.html'));
    for (const p of ['/../secret', '/assets/%2e%2e/%2e%2e/x', '/.env', '/a%00b', '/a%5c..%5cb', '/%E0%A4%A']) {
      expect(staticPath(root, p)).toBeNull();
    }
  });
  it('finds the archives in any capitalization and reports duplicates', () => {
    const { found, problems } = findArchives(path.join(tmp, 'install'));
    expect(problems).toEqual([]);
    expect([...found.keys()].sort()).toEqual(['gs.pak', 'pak0.pak', 'pak1.pak', 'pak2.pak', 'pak3.pak']);
    fs.writeFileSync(path.join(tmp, 'install', 'pak1.pak'), 'dup');
    expect(findArchives(path.join(tmp, 'install')).problems).toContain('pak1.pak exists more than once');
    fs.rmSync(path.join(tmp, 'install', 'pak1.pak'));
  });
});

describe('server', () => {
  it('requires the tester key and trades a valid one for a cookie', async () => {
    expect((await fetch(`${base}/`)).status).toBe(403);
    expect((await fetch(`${base}/?key=wrong-key-1234567`, { redirect: 'manual' })).status).toBe(403);
    const r = await fetch(`${base}/?key=${KEY}`, { redirect: 'manual' });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/');
    expect(r.headers.get('set-cookie')).toMatch(/sof_key=.*HttpOnly; SameSite=Strict/);
  });
  it('serves the manifest without paths', async () => {
    const r = await get('/gamedata/manifest.json');
    const body = await r.text();
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(body).files.map((f: { name: string }) => f.name)).toEqual(['pak0.pak', 'pak1.pak', 'pak2.pak', 'pak3.pak', 'gs.pak']);
    expect(body).not.toContain(tmp.replace(/\\/g, '/').split('/').pop());
  });
  it('serves byte ranges of the archives only', async () => {
    const r = await get('/gamedata/pak0.pak', { range: 'bytes=0-3' });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toMatch(/^bytes 0-3\/\d+$/);
    expect(await r.text()).toBe('PACK');
    expect((await get('/gamedata/pak0.pak', { range: 'bytes=999-' })).status).toBe(416);
    for (const p of ['/gamedata/config.cfg', '/gamedata/../secret.txt', '/gamedata/', '/gamedata/PAK0.PAK', '/secret.txt',
      '/../secret.txt', '/assets/', '/%2e%2e/secret.txt']) {
      expect((await get(p)).status, p).toBe(404);
    }
  });
  it('serves the build and nothing but GET/HEAD', async () => {
    expect((await get('/assets/a.js')).status).toBe(200);
    expect((await fetch(`${base}/`, { method: 'POST', headers: { cookie: `sof_key=${KEY}` } })).status).toBe(405);
  });
});
