import { describe, expect, it } from 'vitest';
import { PakError, readPakDirectory } from '../src/files/pak';
import { bytesSource, makePak } from './fixtures';

describe('readPakDirectory', () => {
  it('reads names, offsets and sizes', async () => {
    const pak = makePak([{ name: 'maps/a.bsp', data: new Uint8Array(5) }, { name: 'b.cfg' }]);
    const dir = await readPakDirectory(bytesSource(pak));
    expect(dir.entries.map((e) => [e.name, e.size])).toEqual([['maps/a.bsp', 5], ['b.cfg', 3]]);
    expect(dir.entries[0].offset).toBe(12);
  });

  it('rejects a wrong signature', async () => {
    const pak = makePak([{ name: 'x' }]);
    pak[0] = 0x58;
    await expect(readPakDirectory(bytesSource(pak))).rejects.toThrow(/signature/);
  });

  it('rejects truncated files', async () => {
    const pak = makePak([{ name: 'x' }]);
    await expect(readPakDirectory(bytesSource(pak.slice(0, pak.length - 10)))).rejects.toThrow(PakError);
    await expect(readPakDirectory(bytesSource(pak.slice(0, 8)))).rejects.toThrow(/too small/);
  });

  it('rejects entries pointing outside the file', async () => {
    const pak = makePak([{ name: 'x' }]);
    const view = new DataView(pak.buffer);
    const dirOfs = view.getInt32(4, true);
    view.setInt32(dirOfs + 60, 1 << 30, true);
    await expect(readPakDirectory(bytesSource(pak))).rejects.toThrow(/out of bounds/);
  });

  it('rejects malformed directory lengths', async () => {
    const pak = makePak([{ name: 'x' }]);
    new DataView(pak.buffer).setInt32(8, 63, true);
    await expect(readPakDirectory(bytesSource(pak))).rejects.toThrow(/directory length/);
  });
});
