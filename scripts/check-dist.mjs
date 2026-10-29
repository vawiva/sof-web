// Inspects a production build directory before anything is deployed:
//  1. no original game data (by extension and by the PACK signature, whatever the file is called)
//  2. no private local paths in text files
//  3. reports build artifacts that still contain third-party material with unresolved provenance;
//     these make the build NOT DEPLOYABLE (exit code 2) - see docs/LICENSING.md
// usage: node scripts/check-dist.mjs dist
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ?? 'dist';
const GAME_EXT = /\.(pak|bsp|ghb|gbm|gsq|m32|adp|os|rof|wal|pcx)$/i;
// absolute paths of a build or player machine (Emscripten's virtual /home/web_user is fine)
const PRIVATE = /[A-Za-z]:[\\/]+Users[\\/]|\/home\/(?!web_user\b)[a-z]|\/Users\/[A-Za-z]|GOG Games/;
// built from openMERC's game module, which compiles in tables whose provenance is unresolved
const UNRESOLVED = new Map([['engine/gamex86.so', 'openMERC game module: gore, animation, prop and script-id tables of unresolved provenance']]);

const problems = [];
const blockers = [];
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) problems.push(`symbolic link in build output: ${p}`);
    else if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(root);

for (const f of files) {
  const rel = path.relative(root, f).split(path.sep).join('/');
  const head = Buffer.alloc(4);
  const fd = fs.openSync(f, 'r');
  fs.readSync(fd, head, 0, 4, 0);
  fs.closeSync(fd);
  const isPack = head.toString('latin1') === 'PACK';
  if (GAME_EXT.test(rel) || isPack) problems.push(`possible game data: ${rel}`);
  if (fs.statSync(f).size < 64e6 && PRIVATE.test(fs.readFileSync(f, 'latin1'))) { // text and binaries
    problems.push(`private path in ${rel}`);
  }
  if (UNRESOLVED.has(rel)) blockers.push(`${rel}: ${UNRESOLVED.get(rel)}`);
}

console.log(`checked ${files.length} files in ${root}`);
for (const p of problems) console.log(`FAIL ${p}`);
for (const b of blockers) console.log(`NOT DEPLOYABLE ${b}`);
if (problems.length) process.exit(1);
if (blockers.length) process.exit(2);
console.log('OK: no game data, no private paths, no unresolved material');
