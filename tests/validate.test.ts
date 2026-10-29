import { describe, expect, it } from 'vitest';
import type { GameSet } from '../src/files/gameset';
import { REQUIRED_ENTRIES, REQUIRED_PAKS } from '../src/games/sof/manifest';
import { validateGameSet } from '../src/games/sof/validate';
import { bytesSource, fakeFile, makePak } from './fixtures';

function setOf(paks: Record<string, Uint8Array>) {
  const set: GameSet = { base: new Map(), ignored: 0 };
  for (const name of Object.keys(paks)) set.base.set(name, { path: name, file: fakeFile(name, paks[name].length) });
  return { set, sourceFor: (n: string) => bytesSource(paks[n]) };
}

// synthetic stand-ins: the campaign file names spread over the five archives
function campaignPaks(): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  REQUIRED_PAKS.forEach((p, i) => {
    out[p] = makePak(REQUIRED_ENTRIES.filter((_, j) => j % REQUIRED_PAKS.length === i).map((name) => ({ name })));
  });
  return out;
}

describe('validateGameSet', () => {
  it('lists every missing archive at once', async () => {
    const paks = campaignPaks();
    delete paks['pak1.pak'];
    delete paks['gs.pak'];
    const { set, sourceFor } = setOf(paks);
    const v = await validateGameSet(set, undefined, sourceFor);
    expect(v.status).toBe('error');
    expect(v.status === 'error' && v.problems[0]).toMatch(/pak1\.pak, gs\.pak/);
  });

  it('rejects data without the campaign', async () => {
    const paks = campaignPaks();
    paks['pak0.pak'] = makePak([{ name: 'maps/dm/x.bsp' }]);
    const { set, sourceFor } = setOf(paks);
    const v = await validateGameSet(set, undefined, sourceFor);
    expect(v.status).toBe('error');
    expect(v.status === 'error' && v.problems[0]).toMatch(/single-player campaign/);
  });

  it('reports a corrupt archive by name', async () => {
    const paks = campaignPaks();
    paks['pak2.pak'] = new Uint8Array(40);
    const { set, sourceFor } = setOf(paks);
    const v = await validateGameSet(set, undefined, sourceFor);
    expect(v.status === 'error' && v.problems.join()).toMatch(/pak2\.pak: not a PACK archive/);
  });

  it('marks complete but unrecognized data as unverified', async () => {
    const { set, sourceFor } = setOf(campaignPaks());
    const v = await validateGameSet(set, undefined, sourceFor);
    expect(v.status).toBe('unverified');
    expect(v.status === 'unverified' && v.differences.length).toBe(5);
  });

  it('can be cancelled', async () => {
    const { set, sourceFor } = setOf(campaignPaks());
    const ac = new AbortController();
    ac.abort();
    await expect(validateGameSet(set, ac.signal, sourceFor)).rejects.toThrow();
  });
});
