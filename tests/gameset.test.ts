import { describe, expect, it } from 'vitest';
import { buildGameSet, normalizePath } from '../src/files/gameset';
import { fakeFile } from './fixtures';

const wanted = (n: string) => /^(pak\d|gs)\.pak$/.test(n);
const sel = (path: string) => ({ path, file: fakeFile(path.split('/').pop()!) });

describe('normalizePath', () => {
  it('normalizes separators and rejects traversal or absolute paths', () => {
    expect(normalizePath('SoF\\base\\PAK0.PAK')).toBe('SoF/base/PAK0.PAK');
    expect(normalizePath('a/../b')).toBeNull();
    expect(normalizePath('/etc/passwd')).toBeNull();
    expect(normalizePath('C:/x')).toBeNull();
  });
});

describe('buildGameSet', () => {
  it('finds archives inside base/ regardless of case', () => {
    const { set, problems } = buildGameSet([
      sel('Soldier of Fortune/Base/PAK0.PAK'), sel('Soldier of Fortune/base/pak1.pak'),
      sel('Soldier of Fortune/SoF.exe'), sel('Soldier of Fortune/base/gamex86.dll'),
    ], wanted);
    expect(problems).toEqual([]);
    expect([...set.base.keys()].sort()).toEqual(['pak0.pak', 'pak1.pak']);
    expect(set.ignored).toBe(2);
  });

  it('accepts loose archives selected on their own', () => {
    const { set } = buildGameSet([sel('pak0.pak'), sel('GS.PAK')], wanted);
    expect([...set.base.keys()].sort()).toEqual(['gs.pak', 'pak0.pak']);
  });

  it('ignores archives outside base/ (e.g. mod folders)', () => {
    const { set } = buildGameSet([sel('SoF/user-mod/pak0.pak')], wanted);
    expect(set.base.size).toBe(0);
  });

  it('reports names that collide when case is ignored instead of picking one', () => {
    const { set, problems } = buildGameSet([sel('a/base/pak0.pak'), sel('b/BASE/PAK0.pak')], wanted);
    expect(set.base.has('pak0.pak')).toBe(false);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('ambiguous');
    expect(problems[0].paths).toEqual(['a/base/pak0.pak', 'b/BASE/PAK0.pak']);
  });

  it('reports unsafe paths', () => {
    const { problems } = buildGameSet([sel('../base/pak0.pak')], wanted);
    expect(problems[0].kind).toBe('unsafe-path');
  });
});
