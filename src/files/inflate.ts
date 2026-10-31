// Raw DEFLATE (RFC 1951) decoder for installer cabinet chunks. InstallShield chunks may end with a final block or
// just with a sync flush, which the browser's DecompressionStream rejects either way ("trailing junk" or "unexpected
// end"), so this decoder stops cleanly at a final block or at the end of the input on a block boundary. Output is
// bounded by `limit`; corrupt input throws. Table-driven (9-bit first-level lookup).

export class InflateError extends Error {}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Canonical Huffman decoding table: entries are (symbol << 4) | length for codes up to 15 bits, indexed by reversed code. */
interface Huff { table: Int32Array; bits: number }

function build(lengths: Uint8Array | number[], n: number): Huff {
  let max = 0;
  const count = new Uint16Array(16);
  for (let i = 0; i < n; i++) { count[lengths[i]]++; if (lengths[i] > max) max = lengths[i]; }
  count[0] = 0;
  if (max === 0) return { table: new Int32Array(1).fill(-1), bits: 1 };
  const next = new Uint16Array(16);
  let code = 0;
  for (let b = 1; b <= 15; b++) { code = (code + count[b - 1]) << 1; next[b] = code; }
  // over-subscribed codes are corrupt
  let left = 1;
  for (let b = 1; b <= 15; b++) { left <<= 1; left -= count[b]; if (left < 0) throw new InflateError('over-subscribed Huffman code'); }
  const size = 1 << max;
  const table = new Int32Array(size).fill(-1);
  for (let s = 0; s < n; s++) {
    const len = lengths[s];
    if (!len) continue;
    let c = next[len]++;
    let r = 0;
    for (let i = 0; i < len; i++) { r = (r << 1) | (c & 1); c >>= 1; }
    for (let i = r; i < size; i += 1 << len) table[i] = (s << 4) | len;
  }
  return { table, bits: max };
}

let FIXED_LIT: Huff | null = null;
let FIXED_DIST: Huff | null = null;
function fixed() {
  if (!FIXED_LIT) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
    FIXED_LIT = build(l, 288);
    FIXED_DIST = build(new Uint8Array(30).fill(5), 30);
  }
  return [FIXED_LIT, FIXED_DIST!] as const;
}

export function inflateRaw(input: Uint8Array, limit: number): Uint8Array {
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.min(limit, Math.max(1024, input.length * 4)));
  let n = 0;
  const end = () => pos >= input.length && bitCnt === 0;
  const need = (k: number) => {
    while (bitCnt < k) {
      if (pos >= input.length) throw new InflateError('unexpected end of compressed data');
      bitBuf |= input[pos++] << bitCnt;
      bitCnt += 8;
    }
  };
  const bits = (k: number) => {
    need(k);
    const v = bitBuf & ((1 << k) - 1);
    bitBuf >>>= k;
    bitCnt -= k;
    return v;
  };
  const decode = (h: Huff) => {
    // fill as many bits as are available, up to the table width
    while (bitCnt < h.bits && pos < input.length) { bitBuf |= input[pos++] << bitCnt; bitCnt += 8; }
    const e = h.table[bitBuf & ((1 << h.bits) - 1)];
    if (e < 0 || (e & 15) > bitCnt) throw new InflateError('invalid Huffman code');
    bitBuf >>>= e & 15;
    bitCnt -= e & 15;
    return e >> 4;
  };
  const grow = (k: number) => {
    if (n + k > limit) throw new InflateError('output exceeds the expected size');
    if (n + k > out.length) {
      const o = new Uint8Array(Math.min(limit, Math.max(out.length * 2, n + k)));
      o.set(out.subarray(0, n));
      out = o;
    }
  };

  for (;;) {
    // a sync flush can end the chunk on a byte boundary without a final block
    if (end()) break;
    if (pos >= input.length && bitCnt < 3) break;
    const final = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0; // to the byte boundary
      if (pos + 4 > input.length) throw new InflateError('truncated stored block');
      const len = input[pos] | (input[pos + 1] << 8);
      const nlen = input[pos + 2] | (input[pos + 3] << 8);
      if ((len ^ 0xffff) !== nlen) throw new InflateError('corrupt stored block length');
      pos += 4;
      if (pos + len > input.length) throw new InflateError('truncated stored block');
      grow(len);
      out.set(input.subarray(pos, pos + len), n);
      n += len;
      pos += len;
    } else if (type === 1 || type === 2) {
      let lit: Huff, dist: Huff;
      if (type === 1) [lit, dist] = fixed();
      else {
        const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        if (hlit > 286 || hdist > 30) throw new InflateError('bad code lengths');
        const cl = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3);
        const clh = build(cl, 19);
        const lens = new Uint8Array(hlit + hdist);
        for (let i = 0; i < hlit + hdist;) {
          const sym = decode(clh);
          if (sym < 16) lens[i++] = sym;
          else {
            let rep: number, val = 0;
            if (sym === 16) { if (i === 0) throw new InflateError('repeat without a previous length'); val = lens[i - 1]; rep = 3 + bits(2); }
            else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (i + rep > hlit + hdist) throw new InflateError('too many code lengths');
            lens.fill(val, i, i + rep);
            i += rep;
          }
        }
        if (!lens[256]) throw new InflateError('no end-of-block code');
        lit = build(lens.subarray(0, hlit), hlit);
        dist = build(lens.subarray(hlit), hdist);
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) {
          if (n >= out.length) grow(1);
          out[n++] = sym;
        } else if (sym === 256) break;
        else {
          const li = sym - 257;
          if (li >= 29) throw new InflateError('bad length code');
          const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
          const di = decode(dist);
          if (di >= 30) throw new InflateError('bad distance code');
          const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
          if (d > n) throw new InflateError('distance before the start of the output');
          grow(len);
          for (let k = 0; k < len; k++) { out[n] = out[n - d]; n++; }
        }
      }
    } else throw new InflateError('invalid block type');
    if (final) break;
  }
  return out.subarray(0, n);
}
