import { describe, it, expect } from 'vitest';
import { encodeWorld, decodeWorld } from '../../src/app/share.js';

describe('AC-20 · a world serializes to a link and restores', () => {
  it('round-trips the verbs that built it', () => {
    const verbs = ['make it rain', 'add fog', 'dim the light'];
    expect(decodeWorld('#' + encodeWorld(verbs))).toEqual(verbs);
  });

  it('survives non-ASCII utterances', () => {
    expect(decodeWorld('#' + encodeWorld(['que llueva', 'añade niebla']))).toEqual(['que llueva', 'añade niebla']);
  });

  it('produces nothing for an empty world', () => {
    expect(encodeWorld([])).toBe('');
  });

  it('is URL-safe: no characters a hash would mangle', () => {
    expect(encodeWorld(['make it rain heavily', 'add fog everywhere'])).toMatch(/^v1:[A-Za-z0-9\-_]+$/);
  });
});

describe('a shared link is untrusted input', () => {
  it('ignores a hash that is not a Verbo world', () => {
    expect(decodeWorld('#section-3')).toEqual([]);
    expect(decodeWorld('')).toEqual([]);
  });

  it('does not throw on corrupted payloads', () => {
    expect(decodeWorld('#v1:not-valid-base64!!')).toEqual([]);
    expect(decodeWorld('#v1:' + btoa('{"broken":'))).toEqual([]);
  });

  it('rejects a payload that is not a list of utterances', () => {
    expect(decodeWorld('#v1:' + btoa('{"verbs":1}'))).toEqual([]);
    expect(decodeWorld('#v1:' + btoa('[1,2,3]'))).toEqual([]);
  });

  it('bounds how much work a link can ask a browser to do', () => {
    const many = Array.from({ length: 200 }, (_, i) => `verb ${i}`);
    expect(decodeWorld('#' + encodeWorld(many))).toHaveLength(12);
  });

  it('bounds the length of any single utterance', () => {
    const long = 'rain '.repeat(500);
    expect(decodeWorld('#' + encodeWorld([long]))[0]!.length).toBe(120);
  });
});
