import { describe, it, expect, beforeEach, vi } from 'vitest';
import { looksLikeKey, storedKey, storeKey, forgetKey } from '../../src/app/byok.js';

/**
 * The hosted build is static, so a visitor's own key is the only way the published URL
 * can demonstrate the system rather than the phrasebook. These hold the two properties
 * that make that acceptable: the key is session-scoped, and nothing here ever claims a
 * key is valid — only that it is shaped like one.
 */
describe('bring your own key', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it('round-trips a key and forgets it on request', () => {
    expect(storedKey()).toBeNull();
    storeKey('sk-ant-abcdefghijklmnopqrstuvwxyz');
    expect(storedKey()).toBe('sk-ant-abcdefghijklmnopqrstuvwxyz');
    forgetKey();
    expect(storedKey()).toBeNull();
  });

  it('survives storage being unavailable rather than throwing', () => {
    vi.stubGlobal('sessionStorage', {
      getItem() { throw new Error('private browsing'); },
      setItem() { throw new Error('private browsing'); },
      removeItem() { throw new Error('private browsing'); },
    });
    // No key is the ordinary case, not an error worth surfacing.
    expect(storedKey()).toBeNull();
    expect(() => storeKey('sk-ant-xxxxxxxxxxxxxxxxxxxxxx')).not.toThrow();
    expect(() => forgetKey()).not.toThrow();
  });

  it.each([
    ['sk-ant-abcdefghijklmnopqrstuvwxyz', true],
    ['  sk-ant-abcdefghijklmnopqrstuvwxyz  ', true],
    ['sk-ant-short', false],
    ['sk-proj-abcdefghijklmnopqrstuvwxyz', false],
    ['', false],
    ['my api key', false],
  ])('%s is %s shaped like a key', (value, expected) => {
    expect(looksLikeKey(value)).toBe(expected);
  });

  it('checks shape and never validity — that is the first call\'s job', () => {
    // A well-formed string that is certainly not a working credential still passes,
    // deliberately: claiming otherwise would be a promise this code cannot keep.
    expect(looksLikeKey('sk-ant-0000000000000000000000')).toBe(true);
  });
});
