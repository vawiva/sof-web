import { describe, expect, it } from 'vitest';
import { Journal, engineFrames, interpret, journalText, redact, type JournalRecord } from '../src/app/journal';

describe('session journal', () => {
  it('removes access keys and token-like strings', () => {
    expect(redact('https://10.0.0.2:8443/?key=Ab12cd34Ef56gh78&x=1')).not.toMatch(/Ab12cd34/);
    expect(redact('cookie sof_key=zz9988aa7766bb55; path=/')).not.toMatch(/zz9988/);
    expect(redact('token 3f9a8b7c6d5e4f3a2b1c')).toBe('token [redacted]');
    expect(redact('engine: Map: tsr1')).toBe('engine: Map: tsr1');
  });
  it('tells a stall from the browser ending the page', () => {
    const base: JournalRecord = { version: 1, startedAt: 'a', ended: null, beatAt: '2026-10-29T20:00:00Z', sinceFrameMs: 0, stage: 'trn1, play, level running', events: [{ t: 1000, m: 'engine: Map: trn1' }] };
    expect(interpret(base)).toMatch(/browser ended it/);
    expect(interpret({ ...base, sinceFrameMs: 30000 })).toMatch(/stopped drawing 30 s/);
    expect(journalText(base)).toMatch(/did NOT end normally/);
  });
  it('keeps a stuck session reportable after a normal close, and the session before it', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
    };
    const first = new Journal('page a, engine b, offline cache none; game data stored on this device, CD');
    first.setStage('tsr1, play, level running, cinematic');
    first.trouble('a cinematic has not ended for 2 minutes');
    first.end('page closed or reloaded');
    const prev = Journal.previousUnclean();
    expect(prev?.trouble).toMatch(/cinematic has not ended/);
    expect(interpret(prev!)).toMatch(/looked stuck .* then closed/);
    expect(journalText(prev!)).toMatch(/Build: page a, engine b/);
    // a clean session after it: no notice, but both stay readable
    const second = new Journal('page a');
    second.setStage('trn1, play, level running');
    second.end('quit through the game menu');
    expect(Journal.previousUnclean()).toBeNull();
    expect(Journal.recent().map((r) => r.trouble ?? null)).toEqual([null, 'a cinematic has not ended for 2 minutes']);
    Journal.forget();
    expect(Journal.recent()).toEqual([]);
  });
});

describe('engineFrames', () => {
  it('lists the engine functions of a WebAssembly trap, innermost first', () => {
    const err = new Error('null function or function signature mismatch');
    err.stack = `RuntimeError: null function or function signature mismatch
    at G_FreeEdict (wasm://wasm/0a1b2c3d:wasm-function[812]:0x4f1a2)
    at SV_Map (http://x/engine/openMerc.wasm:wasm-function[77]:0x1234)
    at callUserCallback (http://x/engine/openMerc.js:1:2)`;
    expect(engineFrames(err)).toBe('G_FreeEdict < SV_Map');
    expect(engineFrames('not an error')).toBe('');
  });
});
