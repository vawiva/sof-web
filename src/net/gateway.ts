// Multiplayer transport of the browser build. The engine hands every datagram for another host to
// Module.netSend and polls Module.netRecv (engine patch, backends/unix/network.c). This carries the datagrams
// over one WebSocket to the gateway of the server that served this page (server/mp-gateway.mjs), which forwards
// them over UDP to the game servers it is configured for.
//
// Frame format (both directions, one datagram per WebSocket message): 4 bytes IPv4 address, 2 bytes port
// (big-endian), then the datagram. Client to gateway: the destination; gateway to client: the sender.
// 255.255.255.255 is the original LAN server search (broadcast); the gateway answers it with its own servers only.

export interface Datagram {
  ip: Uint8Array;
  port: number;
  data: Uint8Array;
}

export interface GatewayStats {
  sent: number;
  received: number;
  dropped: number;
  maxQueue: number;
  state: 'idle' | 'connecting' | 'open' | 'closed' | 'unavailable';
}

const HEADER = 6;
const MAX_DATAGRAM = 1400 + 64; // the engine's MAX_MSGLEN plus slack for connectionless packets
const MAX_QUEUE = 256; // received datagrams waiting for the engine (about 2 s of a busy server)
const MAX_PENDING = 32; // datagrams sent while the WebSocket is still opening

export class GatewayTransport {
  private ws: WebSocket | null = null;
  private inbox: Datagram[] = [];
  private pending: Uint8Array[] = [];
  private retryAt = 0;
  readonly stats: GatewayStats = { sent: 0, received: 0, dropped: 0, maxQueue: 0, state: 'idle' };

  constructor(private readonly url: string) {}

  send(ip: Uint8Array, port: number, data: Uint8Array) {
    if (data.length > MAX_DATAGRAM) return;
    const frame = new Uint8Array(HEADER + data.length);
    frame.set(ip.subarray(0, 4), 0);
    frame[4] = port >> 8;
    frame[5] = port & 0xff;
    frame.set(data, HEADER);
    const ws = this.open();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(frame);
      this.stats.sent++;
    } else if (ws && this.pending.length < MAX_PENDING) {
      this.pending.push(frame);
    }
  }

  recv(): Datagram | undefined {
    return this.inbox.shift();
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }

  /** The WebSocket, opened on first use and again after a loss (at most once per 2 s; the engine keeps resending). */
  private open(): WebSocket | null {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return this.ws;
    if (performance.now() < this.retryAt) return null;
    this.retryAt = performance.now() + 2000;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.stats.state = 'unavailable';
      return null;
    }
    ws.binaryType = 'arraybuffer';
    this.stats.state = 'connecting';
    ws.onopen = () => {
      this.stats.state = 'open';
      for (const f of this.pending.splice(0)) {
        ws.send(f);
        this.stats.sent++;
      }
    };
    ws.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer) || e.data.byteLength < HEADER || e.data.byteLength > HEADER + MAX_DATAGRAM) return;
      const b = new Uint8Array(e.data);
      if (this.inbox.length >= MAX_QUEUE) {
        this.inbox.shift(); // as UDP would: the oldest datagram is lost, not the connection
        this.stats.dropped++;
      }
      this.inbox.push({ ip: b.slice(0, 4), port: (b[4] << 8) | b[5], data: b.slice(HEADER) });
      this.stats.received++;
      this.stats.maxQueue = Math.max(this.stats.maxQueue, this.inbox.length);
    };
    ws.onclose = () => {
      this.stats.state = 'closed';
      this.pending.length = 0;
    };
    this.ws = ws;
    return ws;
  }
}

/** The gateway next to the page (same origin), e.g. wss://192.168.1.20:8443/mp. */
export function defaultGatewayUrl(): string {
  const u = new URL('mp', document.baseURI);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = '';
  return u.href;
}
