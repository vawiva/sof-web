// WebSocket-to-UDP gateway for browser multiplayer (LAN testing). Not a general proxy:
//  - only the configured game servers are reachable; datagrams to any other address are dropped
//  - one UDP socket per browser connection, so the server sees every player as a distinct address/port
//  - one WebSocket message = one datagram (boundaries kept), at most MAX_DATAGRAM bytes
//  - the original LAN server search (broadcast to 255.255.255.255) is answered only by the configured servers, and
//    only connectionless info/status/ping queries are forwarded for it
//  - per-connection token-bucket limits (packets and bytes per second); server-to-browser datagrams are dropped
//    (not queued without bound) while the browser's WebSocket backlog is above MAX_BACKLOG
//  - origin, tester key and LAN address are checked by the host before the upgrade (lan-host.mjs)
// Frames: [4-byte IPv4][2-byte big-endian port][datagram]; client to gateway = destination, gateway to client =
// sender (the server's alias address). 0.0.0.0:0 frames are echoed (latency measurement of the gateway leg).
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { WebSocketServer } from 'ws';

export const HEADER = 6;
export const MAX_DATAGRAM = 1400 + 64;
const MAX_BACKLOG = 256 * 1024;
const MAX_CONNECTIONS = 32;
const RATE_PACKETS = 400; // per second, per connection (the client sends about 30-60 per second)
const RATE_BYTES = 256 * 1024;
const BROADCAST_COMMANDS = /^(info|status|ping)\b/;

/** "host:port=alias-ip:port" or "host:port" (alias = the same address). */
export function parseServerSpec(spec, defaultAlias) {
  const [target, alias] = spec.split('=');
  const t = /^([A-Za-z0-9.-]+):(\d{1,5})$/.exec(target ?? '');
  if (!t) throw new Error(`bad multiplayer server "${spec}" (expected host:port[=alias-ip:port])`);
  const a = alias ? /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(alias) : null;
  if (alias && !a) throw new Error(`bad alias in "${spec}" (expected IPv4:port)`);
  const port = Number(t[2]);
  const aliasIps = a ? [a[1]] : defaultAlias;
  return { host: t[1], port, aliasIps, aliasPort: a ? Number(a[2]) : port };
}

const ipBytes = (ip) => ip.split('.').map(Number);
const ipString = (b) => `${b[0]}.${b[1]}.${b[2]}.${b[3]}`;

export function frame(ip, port, payload) {
  const f = Buffer.alloc(HEADER + payload.length);
  ipBytes(ip).forEach((v, i) => { f[i] = v; });
  f.writeUInt16BE(port, 4);
  payload.copy(f, HEADER);
  return f;
}

class Bucket {
  constructor(rate) { this.rate = rate; this.tokens = rate; this.at = Date.now(); }
  take(n) {
    const now = Date.now();
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/**
 * servers: parsed server specs. Returns { handleUpgrade(req, socket, head), stats(), close() }.
 */
export function createGateway({ servers, log = () => {} }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: HEADER + MAX_DATAGRAM, perMessageDeflate: false });
  const totals = { connections: 0, active: 0, toServer: 0, toClient: 0, dropped: 0, rejected: 0 };
  let resolved = null;
  const resolve = async () => {
    resolved ??= Promise.all(servers.map(async (s) => ({ ...s, ip: (await dns.lookup(s.host, { family: 4 })).address })));
    return resolved;
  };

  wss.on('connection', async (ws, req) => {
    const list = await resolve().catch(() => []);
    totals.connections++;
    totals.active++;
    const id = totals.connections;
    const st = { toServer: 0, toClient: 0, dropped: 0, invalid: 0, maxBacklog: 0, opened: Date.now() };
    const packets = new Bucket(RATE_PACKETS);
    const bytes = new Bucket(RATE_BYTES);
    const udp = dgram.createSocket('udp4');
    udp.bind(0);
    const byAlias = (ip, port) => list.find((s) => s.aliasPort === port && s.aliasIps.includes(ip));
    // replies must come from the address the client used (its netchan accepts nothing else): remember it per
    // server; before any use (broadcast search) answer as the address the page was loaded from, if it is an alias
    const pageHost = (req.headers.host ?? '').replace(/:\d+$/, '');
    const replyIp = new Map(list.map((s) => [s, s.aliasIps.includes(pageHost) ? pageHost : s.aliasIps[0]]));

    udp.on('message', (msg, rinfo) => {
      const s = list.find((x) => x.ip === rinfo.address && x.port === rinfo.port);
      if (!s || msg.length > MAX_DATAGRAM) return; // only the configured servers answer
      st.maxBacklog = Math.max(st.maxBacklog, ws.bufferedAmount);
      if (ws.bufferedAmount > MAX_BACKLOG) {
        st.dropped++;
        totals.dropped++;
        return;
      }
      ws.send(frame(replyIp.get(s), s.aliasPort, msg), { binary: true });
      st.toClient++;
      totals.toClient++;
    });
    udp.on('error', () => ws.close(1011, 'udp error'));

    ws.on('message', (data, isBinary) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (!isBinary || buf.length < HEADER || buf.length > HEADER + MAX_DATAGRAM) {
        if (++st.invalid > 20) ws.close(1008, 'invalid frames');
        return;
      }
      if (!packets.take(1) || !bytes.take(buf.length)) {
        st.dropped++;
        totals.dropped++;
        return;
      }
      const ip = ipString(buf);
      const port = buf.readUInt16BE(4);
      const payload = buf.subarray(HEADER);
      if (ip === '0.0.0.0' && port === 0) { // latency probe of the WebSocket leg
        if (payload.length <= 64) ws.send(buf, { binary: true });
        return;
      }
      if (ip === '255.255.255.255') {
        const connectionless = payload.length > 4 && payload.readInt32LE(0) === -1;
        if (!connectionless || !BROADCAST_COMMANDS.test(payload.subarray(4).toString('latin1'))) return;
        for (const s of list) if (s.aliasPort === port || port === 0) udp.send(payload, s.port, s.ip);
        st.toServer++;
        return;
      }
      const s = byAlias(ip, port);
      if (!s) {
        if (++st.invalid > 200) ws.close(1008, 'not a configured server');
        return;
      }
      replyIp.set(s, ip);
      udp.send(payload, s.port, s.ip);
      st.toServer++;
      totals.toServer++;
    });
    ws.on('close', () => {
      totals.active--;
      udp.close();
      log(`gateway #${id} closed after ${Math.round((Date.now() - st.opened) / 1000)} s: ${JSON.stringify(st)}`);
    });
    log(`gateway #${id} opened from ${req.socket.remoteAddress}`);
  });

  return {
    handleUpgrade(req, socket, head) {
      if (totals.active >= MAX_CONNECTIONS) {
        totals.rejected++;
        socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    stats: () => ({ ...totals }),
    close: () => wss.close(),
  };
}
