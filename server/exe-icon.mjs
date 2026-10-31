// The game's own icon for the installed app, taken at run time from the player's installed SoF.exe (read-only) and
// never stored: this project does not include the game's artwork. The executable's icon is a small palette bitmap; it
// is enlarged by whole pixels (nearest neighbour, so the pixel art stays sharp and undistorted) and centred on its own
// background colour for sizes that are not whole multiples.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** Finds the game executable in the data folder or its parent (the data folder may be "base"). */
export function findExe(dataDir) {
  for (const dir of [dataDir, path.dirname(dataDir)]) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    const hit = names.find((n) => n.toLowerCase() === 'sof.exe');
    if (hit) return path.join(dir, hit);
  }
  return null;
}

/** Resource payloads by type id: Map<type, Array<{ id, data }>> (first language of each name). */
export function peResources(buf) {
  const u16 = (o) => buf.readUInt16LE(o);
  const u32 = (o) => buf.readUInt32LE(o);
  if (buf.length < 64 || u16(0) !== 0x5a4d) throw new Error('not an executable');
  const pe = u32(0x3c);
  if (u32(pe) !== 0x4550) throw new Error('not a PE image');
  const nsec = u16(pe + 6);
  const optSize = u16(pe + 20);
  const opt = pe + 24;
  const magic = u16(opt);
  const dirs = opt + (magic === 0x20b ? 112 : 96);
  const rsrcRva = u32(dirs + 2 * 8);
  if (!rsrcRva) return new Map();
  const secs = [];
  for (let i = 0; i < nsec; i++) {
    const s = opt + optSize + i * 40;
    secs.push({ va: u32(s + 12), vsize: Math.max(u32(s + 8), u32(s + 16)), raw: u32(s + 20) });
  }
  const off = (rva) => {
    const s = secs.find((x) => rva >= x.va && rva < x.va + x.vsize);
    if (!s) throw new Error('resource outside the sections');
    return rva - s.va + s.raw;
  };
  const base = off(rsrcRva);
  const entries = (dirOff) => {
    const n = u16(dirOff + 12) + u16(dirOff + 14);
    if (n > 4096) throw new Error('resource directory too large');
    return Array.from({ length: n }, (_, i) => ({ name: u32(dirOff + 16 + i * 8), to: u32(dirOff + 20 + i * 8) }));
  };
  const out = new Map();
  for (const t of entries(base)) {
    if (!(t.to & 0x80000000) || (t.name & 0x80000000)) continue;
    const list = [];
    for (const n of entries(base + (t.to & 0x7fffffff))) {
      if (!(n.to & 0x80000000)) continue;
      const langs = entries(base + (n.to & 0x7fffffff));
      if (!langs.length || (langs[0].to & 0x80000000)) continue;
      const de = base + langs[0].to;
      const start = off(u32(de));
      const size = u32(de + 4);
      if (start + size > buf.length) throw new Error('resource beyond the file');
      list.push({ id: n.name & 0x80000000 ? -1 : n.name, data: buf.subarray(start, start + size) });
    }
    out.set(t.name, list);
  }
  return out;
}

/** The largest image of the first icon group, decoded to RGBA. */
export function exeIconRGBA(buf) {
  const res = peResources(buf);
  const group = res.get(14)?.[0]?.data;
  const icons = res.get(3) ?? [];
  if (!group) throw new Error('no icon in the executable');
  const count = group.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 14;
    const w = group[e] || 256;
    const id = group.readUInt16LE(e + 12);
    if (!best || w > best.w) best = { w, id };
  }
  const img = icons.find((x) => x.id === best?.id)?.data;
  if (!img) throw new Error('icon image missing');
  return decodeDib(img);
}

export function decodeDib(b) {
  const hsize = b.readUInt32LE(0);
  const w = b.readInt32LE(4);
  const h = b.readInt32LE(8) / 2; // colour bitmap plus AND mask
  const bpp = b.readUInt16LE(14);
  if (w <= 0 || h <= 0 || w > 256 || h > 256 || ![1, 4, 8, 24, 32].includes(bpp)) throw new Error('unsupported icon format');
  const colours = bpp <= 8 ? (b.readUInt32LE(32) || 1 << bpp) : 0;
  const pal = [];
  for (let i = 0; i < colours; i++) pal.push([b[hsize + i * 4 + 2], b[hsize + i * 4 + 1], b[hsize + i * 4]]);
  const xorOff = hsize + colours * 4;
  const stride = Math.ceil((w * bpp) / 32) * 4;
  const maskOff = xorOff + stride * h;
  const maskStride = Math.ceil(w / 32) * 4;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = xorOff + (h - 1 - y) * stride;
    const mrow = maskOff + (h - 1 - y) * maskStride;
    for (let x = 0; x < w; x++) {
      let r, g, bl, a = 255;
      if (bpp <= 8) {
        const bit = x * bpp;
        const v = (b[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        [r, g, bl] = pal[v] ?? [0, 0, 0];
      } else {
        const p = row + x * (bpp / 8);
        [bl, g, r] = [b[p], b[p + 1], b[p + 2]];
        if (bpp === 32) a = b[p + 3];
      }
      if (bpp !== 32 && maskOff + maskStride * h <= b.length && (b[mrow + (x >> 3)] >> (7 - (x & 7))) & 1) a = 0;
      out.set([r, g, bl, a], (y * w + x) * 4);
    }
  }
  return { w, h, rgba: out };
}

/** Whole-pixel enlargement centred on the top-left pixel's colour (inset: fraction left free on each side). */
export function fitIcon(src, size, inset = 0) {
  const room = Math.round(size * (1 - 2 * inset));
  const k = Math.max(1, Math.floor(room / src.w));
  const out = Buffer.alloc(size * size * 4);
  const bg = src.rgba.subarray(0, 4);
  if (k * src.w > size) { // smaller than the source: average blocks
    const f = src.w / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let sy = Math.floor(y * f); sy < Math.floor((y + 1) * f); sy++) for (let sx = Math.floor(x * f); sx < Math.floor((x + 1) * f); sx++) {
        for (let c = 0; c < 4; c++) acc[c] += src.rgba[(sy * src.w + sx) * 4 + c];
        n++;
      }
      out.set(acc.map((v) => Math.round(v / n)), (y * size + x) * 4);
    }
    return out;
  }
  for (let i = 0; i < size * size; i++) out.set(bg, i * 4);
  const ox = Math.floor((size - k * src.w) / 2);
  const oy = Math.floor((size - k * src.h) / 2);
  for (let y = 0; y < k * src.h; y++) for (let x = 0; x < k * src.w; x++) {
    const s = (Math.floor(y / k) * src.w + Math.floor(x / k)) * 4;
    out.set(src.rgba.subarray(s, s + 4), ((oy + y) * size + ox + x) * 4);
  }
  return out;
}

export function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The icon files the page asks for, by name: [size, inset]. */
export const ICON_FILES = {
  'favicon-16.png': [16, 0], 'favicon-32.png': [32, 0], 'apple-touch-icon.png': [180, 0], 'icon-192.png': [192, 0],
  'icon-512.png': [512, 0], 'icon-maskable-512.png': [512, 0.1],
};

/** Icon files made from the executable, or null when it cannot be read (the page's own icons are used then). */
export function gameIcons(dataDir) {
  try {
    const exe = findExe(dataDir);
    if (!exe) return null;
    const src = exeIconRGBA(fs.readFileSync(exe));
    return new Map(Object.entries(ICON_FILES).map(([name, [size, inset]]) => [name, png(size, fitIcon(src, size, inset))]));
  } catch {
    return null;
  }
}
