// Incremental MD5 (RFC 1321). Used only to check extracted files against the checksums their installer cabinet
// records - not for security. Web Crypto offers no MD5, and the data is hashed in bounded pieces.

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export class Md5 {
  private h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  private buf = new Uint8Array(64);
  private fill = 0;
  private bytes = 0;
  private w = new Uint32Array(16);

  update(data: Uint8Array): this {
    let at = 0;
    this.bytes += data.length;
    if (this.fill) {
      const k = Math.min(64 - this.fill, data.length);
      this.buf.set(data.subarray(0, k), this.fill);
      this.fill += k;
      at = k;
      if (this.fill < 64) return this;
      this.block(this.buf, 0);
      this.fill = 0;
    }
    for (; at + 64 <= data.length; at += 64) this.block(data, at);
    if (at < data.length) { this.buf.set(data.subarray(at)); this.fill = data.length - at; }
    return this;
  }

  /** lower-case hex digest; the object must not be used afterwards */
  hex(): string {
    const bits = this.bytes * 8;
    const pad = new Uint8Array(((this.fill < 56 ? 56 : 120) - this.fill) + 8);
    pad[0] = 0x80;
    const n = pad.length - 8;
    for (let i = 0; i < 8; i++) pad[n + i] = Math.floor(bits / 2 ** (8 * i)) & 0xff;
    this.bytes -= pad.length; // padding is not message length
    this.update(pad);
    let s = '';
    for (const v of this.h) for (let i = 0; i < 4; i++) s += ((v >>> (8 * i)) & 0xff).toString(16).padStart(2, '0');
    return s;
  }

  private block(d: Uint8Array, at: number) {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = d[at + 4 * i] | (d[at + 4 * i + 1] << 8) | (d[at + 4 * i + 2] << 16) | (d[at + 4 * i + 3] << 24);
    let [a, b, c, e] = this.h;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & e); g = i; }
      else if (i < 32) { f = (e & b) | (~e & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ e; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~e); g = (7 * i) & 15; }
      const t = e;
      e = c;
      c = b;
      const x = (a + f + K[i] + w[g]) | 0;
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) | 0;
      a = t;
    }
    this.h[0] += a; this.h[1] += b; this.h[2] += c; this.h[3] += e;
  }
}
