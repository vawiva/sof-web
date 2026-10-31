// LZMA and LZMA2 decoders (streaming output, bounded memory: the dictionary plus one output piece). Written from the
// published format description (Igor Pavlov's LZMA specification, public domain); used to read the GOG installer's
// compressed blocks without running it. Input comes from a pull function; all values are validated.

export class LzmaError extends Error {}

/** Pulls compressed bytes: returns the next piece, or an empty array at the end of the input. */
export type Pull = () => Promise<Uint8Array>;

class Input {
  private buf = new Uint8Array(0);
  private at = 0;
  constructor(private pull: Pull) {}
  async ensure(n: number): Promise<boolean> {
    while (this.buf.length - this.at < n) {
      const more = await this.pull();
      if (!more.length) return false;
      const rest = this.buf.subarray(this.at);
      const b = new Uint8Array(rest.length + more.length);
      b.set(rest);
      b.set(more, rest.length);
      this.buf = b;
      this.at = 0;
    }
    return true;
  }
  /** synchronous byte; ensure() must have made it available */
  byte(): number {
    if (this.at >= this.buf.length) throw new LzmaError('compressed data ended early');
    return this.buf[this.at++];
  }
  available() { return this.buf.length - this.at; }
  async need(n: number) { if (!(await this.ensure(n))) throw new LzmaError('compressed data ended early'); }
}

const kNumStates = 12;
const kMatchMinLen = 2;
const kEndPosModelIndex = 14;
const kNumFullDistances = 128;
const kNumAlignBits = 4;

class Range {
  range = 0xffffffff;
  code = 0;
  constructor(private inp: Input) {}
  init() {
    if (this.inp.byte() !== 0) throw new LzmaError('corrupt range coder start');
    this.range = 0xffffffff;
    this.code = 0;
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.inp.byte()) >>> 0;
    if (this.code === this.range) throw new LzmaError('corrupt range coder start');
  }
  private normalize() {
    if (this.range < 0x1000000) {
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | this.inp.byte()) >>> 0;
    }
  }
  bit(probs: Uint16Array, i: number): number {
    const p = probs[i];
    const bound = (this.range >>> 11) * p;
    let r: number;
    if (this.code < bound) {
      probs[i] = p + ((2048 - p) >>> 5);
      this.range = bound;
      r = 0;
    } else {
      probs[i] = p - (p >>> 5);
      this.code -= bound;
      this.range -= bound;
      r = 1;
    }
    this.normalize();
    return r;
  }
  direct(n: number): number {
    let res = 0;
    for (; n > 0; n--) {
      this.range >>>= 1;
      let t = 0;
      if (this.code >= this.range) { this.code -= this.range; t = 1; }
      res = ((res << 1) | t) >>> 0;
      this.normalize();
    }
    return res;
  }
}

const probs = (n: number) => new Uint16Array(n).fill(1024);
function bitTree(rc: Range, p: Uint16Array, base: number, bits: number) {
  let m = 1;
  for (let i = 0; i < bits; i++) m = (m << 1) | rc.bit(p, base + m);
  return m - (1 << bits);
}
function bitTreeReverse(rc: Range, p: Uint16Array, base: number, bits: number) {
  let m = 1, sym = 0;
  for (let i = 0; i < bits; i++) { const b = rc.bit(p, base + m); m = (m << 1) | b; sym |= b << i; }
  return sym;
}

class LenDecoder {
  choice = probs(2);
  low = probs(16 << 3);
  mid = probs(16 << 3);
  high = probs(256);
  reset() { for (const a of [this.choice, this.low, this.mid, this.high]) a.fill(1024); }
  decode(rc: Range, posState: number) {
    if (!rc.bit(this.choice, 0)) return bitTree(rc, this.low, posState << 3, 3);
    if (!rc.bit(this.choice, 1)) return 8 + bitTree(rc, this.mid, posState << 3, 3);
    return 16 + bitTree(rc, this.high, 0, 8);
  }
}

/** The sliding dictionary; finished output is handed out in pieces. */
class Window {
  buf: Uint8Array;
  pos = 0;
  full = false;
  total = 0;
  private flushed = 0;
  constructor(size: number) { this.buf = new Uint8Array(size); }
  put(b: number) {
    this.buf[this.pos++] = b;
    this.total++;
    if (this.pos === this.buf.length) { this.pos = 0; this.full = true; }
  }
  get(dist: number) { const i = this.pos - dist; return this.buf[i < 0 ? i + this.buf.length : i]; }
  copy(dist: number, len: number) { for (; len > 0; len--) this.put(this.get(dist)); }
  has(dist: number) { return this.full || dist <= this.pos; }
  /** output written since the last call (copied out: the window keeps being reused) */
  take(): Uint8Array {
    const n = this.total - this.flushed;
    if (n <= 0) return new Uint8Array(0);
    const out = new Uint8Array(n);
    const end = this.pos;
    const start = end - n;
    if (start >= 0) out.set(this.buf.subarray(start, end));
    else { out.set(this.buf.subarray(this.buf.length + start)); out.set(this.buf.subarray(0, end), -start); }
    this.flushed = this.total;
    return out;
  }
  /** bytes not yet taken; the window must be drained before they would be overwritten */
  pending() { return this.total - this.flushed; }
}

/** The LZMA decoder state (shared by LZMA1 and LZMA2, which resets parts of it between chunks). */
class Decoder {
  lc = 0; lp = 0; pb = 0;
  literal!: Uint16Array;
  isMatch = probs(kNumStates << 4);
  isRep = probs(kNumStates);
  isRepG0 = probs(kNumStates);
  isRepG1 = probs(kNumStates);
  isRepG2 = probs(kNumStates);
  isRep0Long = probs(kNumStates << 4);
  posSlot = probs(4 << 6);
  posDecoders = probs(1 + kNumFullDistances - kEndPosModelIndex);
  align = probs(1 << kNumAlignBits);
  len = new LenDecoder();
  repLen = new LenDecoder();
  state = 0;
  reps = [0, 0, 0, 0];
  constructor(readonly win: Window) {}

  setProps(lc: number, lp: number, pb: number) {
    if (lc > 8 || lp > 4 || pb > 4) throw new LzmaError('invalid LZMA properties');
    this.lc = lc; this.lp = lp; this.pb = pb;
    this.literal = probs(0x300 << (lc + lp));
  }
  resetState() {
    this.literal.fill(1024);
    for (const a of [this.isMatch, this.isRep, this.isRepG0, this.isRepG1, this.isRepG2, this.isRep0Long, this.posSlot, this.posDecoders, this.align]) a.fill(1024);
    this.len.reset();
    this.repLen.reset();
    this.state = 0;
    this.reps = [0, 0, 0, 0];
  }

  /**
   * Decodes until `limit` bytes were produced in total (or the end marker when allowed). The input must already hold
   * enough bytes for this run; `budget` bounds the work per call so the caller can drain output and refill input.
   * Returns 'end' at an end marker, 'limit' when `limit` was reached, 'more' when the budget ran out.
   */
  run(rc: Range, limit: number, budget: number, allowEnd: boolean): 'end' | 'limit' | 'more' {
    const w = this.win;
    const pbMask = (1 << this.pb) - 1;
    const lpMask = (1 << this.lp) - 1;
    let n = 0;
    while (w.total < limit) {
      if (n++ >= budget) return 'more';
      const posState = w.total & pbMask;
      const s = this.state;
      if (!rc.bit(this.isMatch, (s << 4) + posState)) {
        const prev = w.total > 0 || w.full ? w.get(1) : 0;
        const base = 0x300 * (((w.total & lpMask) << this.lc) + (prev >>> (8 - this.lc)));
        let sym = 1;
        if (s >= 7) {
          let match = w.get(this.reps[0] + 1);
          do {
            const mb = (match >>> 7) & 1;
            match <<= 1;
            const b = rc.bit(this.literal, base + ((1 + mb) << 8) + sym);
            sym = (sym << 1) | b;
            if (mb !== b) break;
          } while (sym < 0x100);
        }
        while (sym < 0x100) sym = (sym << 1) | rc.bit(this.literal, base + sym);
        w.put(sym - 0x100);
        this.state = s < 4 ? 0 : s < 10 ? s - 3 : s - 6;
        continue;
      }
      let len: number;
      if (rc.bit(this.isRep, s)) {
        if (w.total === 0 && !w.full) throw new LzmaError('repeat match at the start of the data');
        if (!rc.bit(this.isRepG0, s)) {
          if (!rc.bit(this.isRep0Long, (s << 4) + posState)) {
            this.state = s < 7 ? 9 : 11;
            w.put(w.get(this.reps[0] + 1));
            continue;
          }
        } else {
          let dist: number;
          if (!rc.bit(this.isRepG1, s)) dist = this.reps[1];
          else {
            if (!rc.bit(this.isRepG2, s)) dist = this.reps[2];
            else { dist = this.reps[3]; this.reps[3] = this.reps[2]; }
            this.reps[2] = this.reps[1];
          }
          this.reps[1] = this.reps[0];
          this.reps[0] = dist;
        }
        len = this.repLen.decode(rc, posState);
        this.state = s < 7 ? 8 : 11;
      } else {
        this.reps[3] = this.reps[2]; this.reps[2] = this.reps[1]; this.reps[1] = this.reps[0];
        len = this.len.decode(rc, posState);
        this.state = s < 7 ? 7 : 10;
        const lenState = Math.min(len, 3);
        const slot = bitTree(rc, this.posSlot, lenState << 6, 6);
        let dist: number;
        if (slot < 4) dist = slot;
        else {
          const direct = (slot >>> 1) - 1;
          dist = ((2 | (slot & 1)) << direct) >>> 0;
          if (slot < kEndPosModelIndex) dist += bitTreeReverse(rc, this.posDecoders, dist - slot, direct);
          else {
            dist = (dist + (rc.direct(direct - kNumAlignBits) << kNumAlignBits)) >>> 0;
            dist = (dist + bitTreeReverse(rc, this.align, 0, kNumAlignBits)) >>> 0;
          }
        }
        if (dist === 0xffffffff) {
          if (!allowEnd) throw new LzmaError('unexpected end marker');
          return 'end';
        }
        this.reps[0] = dist;
      }
      len += kMatchMinLen;
      const dist = this.reps[0] + 1;
      if (dist > w.buf.length || !w.has(dist)) throw new LzmaError('match distance beyond the data');
      if (w.total + len > limit) throw new LzmaError('data longer than expected');
      w.copy(dist, len);
    }
    return 'limit';
  }
}

/** Upper bound of input one decoding step may consume, so `run` never reads past what is buffered. */
const STEP_BYTES = 64;
const BUDGET = 4096;

export interface LzmaOptions {
  /** exact uncompressed size, when known (LZMA1 without end marker needs it) */
  size?: number;
  /** largest dictionary accepted (memory bound); default 64 MB */
  maxDict?: number;
  signal?: AbortSignal;
}

/** LZMA1 with a 5-byte properties header (lc/lp/pb byte + 32-bit dictionary size), as Inno Setup stores it. */
export async function lzmaDecode(pull: Pull, sink: (d: Uint8Array) => Promise<void> | void, opts: LzmaOptions = {}) {
  const inp = new Input(pull);
  await inp.need(5);
  let d = inp.byte();
  if (d >= 9 * 5 * 5) throw new LzmaError('invalid LZMA properties');
  const lc = d % 9; d = (d / 9) | 0;
  const lp = d % 5, pb = (d / 5) | 0;
  let dict = 0;
  for (let i = 0; i < 4; i++) dict |= inp.byte() << (8 * i);
  dict = Math.max(dict >>> 0, 4096);
  if (dict > (opts.maxDict ?? 64 << 20)) throw new LzmaError(`LZMA dictionary of ${dict} bytes exceeds the limit`);
  const win = new Window(Math.min(dict, Math.max(opts.size ?? dict, 4096)));
  const dec = new Decoder(win);
  dec.setProps(lc, lp, pb);
  dec.resetState();
  const rc = new Range(inp);
  await inp.need(5);
  rc.init();
  const limit = opts.size ?? Number.MAX_SAFE_INTEGER;
  for (;;) {
    opts.signal?.throwIfAborted();
    // keep enough input for a bounded number of steps, and drain output before the window would wrap over it
    await inp.ensure(STEP_BYTES * BUDGET);
    const budget = Math.min(BUDGET, Math.max(1, ((inp.available() / STEP_BYTES) | 0)), Math.max(1, (win.buf.length - win.pending()) >> 9));
    const r = dec.run(rc, limit, budget, opts.size === undefined);
    const out = win.take();
    if (out.length) await sink(out);
    if (r === 'end' || r === 'limit') return;
  }
}

/** LZMA2 stream with its 1-byte dictionary property (as Inno Setup stores it). */
export async function lzma2Decode(pull: Pull, sink: (d: Uint8Array) => Promise<void> | void, opts: LzmaOptions = {}) {
  const inp = new Input(pull);
  await inp.need(1);
  const p = inp.byte();
  if (p > 40) throw new LzmaError('invalid LZMA2 dictionary size');
  const dict = p === 40 ? 0xffffffff : (2 | (p & 1)) * 2 ** ((p >>> 1) + 11);
  if (dict > (opts.maxDict ?? 64 << 20)) throw new LzmaError(`LZMA2 dictionary of ${dict} bytes exceeds the limit`);
  const win = new Window(Math.min(dict, Math.max(opts.size ?? dict, 4096)));
  const dec = new Decoder(win);
  let propsSet = false;
  const rc = new Range(inp);
  for (;;) {
    opts.signal?.throwIfAborted();
    await inp.need(1);
    const c = inp.byte();
    if (c === 0) return;
    if (c === 1 || c === 2) {
      // uncompressed chunk (1: dictionary reset)
      await inp.need(2);
      const size = ((inp.byte() << 8) | inp.byte()) + 1;
      await inp.need(size);
      for (let i = 0; i < size; i++) win.put(inp.byte());
      const out = win.take();
      if (out.length) await sink(out);
      continue;
    }
    if (c < 0x80) throw new LzmaError('invalid LZMA2 chunk');
    await inp.need(4);
    const unpacked = (((c & 0x1f) << 16) | (inp.byte() << 8) | inp.byte()) + 1;
    const packed = ((inp.byte() << 8) | inp.byte()) + 1;
    const mode = (c >>> 5) & 3;
    if (mode >= 2) {
      await inp.need(1);
      let d = inp.byte();
      if (d >= 9 * 5 * 5) throw new LzmaError('invalid LZMA properties');
      const lc = d % 9; d = (d / 9) | 0;
      const lp = d % 5, pb = (d / 5) | 0;
      if (lc + lp > 4) throw new LzmaError('invalid LZMA2 properties');
      dec.setProps(lc, lp, pb);
      propsSet = true;
    }
    if (!propsSet) throw new LzmaError('LZMA2 chunk without properties');
    if (mode >= 1) dec.resetState();
    await inp.need(packed);
    rc.init();
    const limit = win.total + unpacked;
    // the whole chunk is buffered; output is drained before the window could wrap over it (a step writes <= 273 bytes)
    while (dec.run(rc, limit, Math.max(1, (win.buf.length - win.pending()) >> 9), false) === 'more') {
      const out = win.take();
      if (out.length) await sink(out);
    }
    const out = win.take();
    if (out.length) await sink(out);
  }
}
