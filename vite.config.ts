import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// The engine (public/engine/, produced by `npm run engine`) is copied verbatim into the build.
// public/ must only ever contain redistributable build output - never game data.

const ENGINE_DIR = path.resolve(__dirname, 'public/engine');
const ENGINE_FILES = ['openMerc.js', 'openMerc.wasm', 'ref_gles3.so', 'OMsnd.so', 'gamex86.so', 'player.so'];

/** A hash of the engine files: the page requests them with ?v=<hash>, so cached copies always match the page. */
function engineVersion(): string {
  const h = createHash('sha256');
  for (const f of ENGINE_FILES) {
    const p = path.join(ENGINE_DIR, f);
    h.update(f).update(fs.existsSync(p) ? fs.readFileSync(p) : '');
  }
  return h.digest('hex').slice(0, 16);
}

/** Writes dist/sw.js from pwa/sw.template.js with the list of files of this build and a version hash of them. */
function serviceWorker(engine: string): Plugin {
  let outDir = 'dist';
  return {
    name: 'sof-service-worker',
    apply: 'build',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    closeBundle() {
      const files: string[] = [];
      (function walk(dir: string) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else files.push(path.relative(outDir, p).split(path.sep).join('/'));
        }
      })(outDir);
      // what the app needs to start and run offline; notices and licence texts stay online-only
      const keep = files.filter((f) => f !== 'sw.js' && !/\.(md|txt)$/i.test(f) && !f.startsWith('engine/licenses/') &&
        f !== 'engine/engine.json' && f !== 'index.html').sort();
      const h = createHash('sha256');
      for (const f of keep) h.update(f).update(fs.readFileSync(path.join(outDir, f)));
      h.update(fs.readFileSync(path.join(outDir, 'index.html')));
      const urls = ['./', ...keep.map((f) => (f.startsWith('engine/') && ENGINE_FILES.includes(f.slice(7)) ? `${f}?v=${engine}` : f))];
      const sw = fs.readFileSync(path.resolve(__dirname, 'pwa/sw.template.js'), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(h.digest('hex').slice(0, 16)))
        .replace('__PRECACHE__', JSON.stringify(urls, null, 1));
      fs.writeFileSync(path.join(outDir, 'sw.js'), sw);
    },
  };
}

const ENGINE_VERSION = engineVersion();

export default defineConfig({
  base: './',
  define: { __ENGINE_VERSION__: JSON.stringify(ENGINE_VERSION) },
  plugins: [serviceWorker(ENGINE_VERSION)],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
