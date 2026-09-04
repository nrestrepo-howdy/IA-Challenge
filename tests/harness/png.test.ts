import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { encodePng, toBase64 } from '../../src/harness/png.js';
import type { Frame } from '../../src/harness/l3-perceptual.js';

/** The encoder is hand-written, so the tests decode it rather than trusting it. */
const frame = (w: number, h: number): Frame => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    data[p * 4] = p % 256;
    data[p * 4 + 1] = (p * 7) % 256;
    data[p * 4 + 2] = (p * 13) % 256;
    data[p * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
};

function chunks(png: Uint8Array): { type: string; body: Uint8Array }[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; body: Uint8Array }[] = [];
  for (let o = 8; o < png.length;) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    out.push({ type, body: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  return out;
}

describe('PNG encoding for the L3 critic', () => {
  it('writes a signature and the chunks in the order a decoder expects', () => {
    const png = encodePng(frame(4, 3));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(chunks(png).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('declares the frame size as 8-bit RGBA', () => {
    const ihdr = chunks(encodePng(frame(160, 90))).find((c) => c.type === 'IHDR')!;
    const view = new DataView(ihdr.body.buffer, ihdr.body.byteOffset, ihdr.body.byteLength);
    expect([view.getUint32(0), view.getUint32(4)]).toEqual([160, 90]);
    expect([ihdr.body[8], ihdr.body[9]]).toEqual([8, 6]);
  });

  it('produces a zlib stream that inflates back to the original pixels', () => {
    // node:zlib is the reference decoder here, and only here -- the encoder itself
    // must run in the browser, where it does not exist.
    const src = frame(9, 5);
    const idat = chunks(encodePng(src)).find((c) => c.type === 'IDAT')!;
    const raw = new Uint8Array(inflateSync(Buffer.from(idat.body)));
    expect(raw.length).toBe((9 * 4 + 1) * 5);
    for (let y = 0; y < 5; y++) {
      expect(raw[y * 37]).toBe(0);   // filter byte: none
      expect([...raw.subarray(y * 37 + 1, y * 37 + 37)])
        .toEqual([...src.data.subarray(y * 36, y * 36 + 36)]);
    }
  });

  it('survives a payload larger than one stored deflate block', () => {
    const idat = chunks(encodePng(frame(160, 120))).find((c) => c.type === 'IDAT')!;
    expect(idat.body.length).toBeGreaterThan(0xffff);
    expect(inflateSync(Buffer.from(idat.body)).length).toBe((160 * 4 + 1) * 120);
  });

  it('refuses a frame whose buffer is shorter than its declared size', () => {
    const short: Frame = { width: 10, height: 10, data: new Uint8ClampedArray(40) };
    expect(() => encodePng(short)).toThrow(/short of/);
  });

  it('base64-encodes without newlines, which the image content block requires', () => {
    const b64 = toBase64(encodePng(frame(64, 64)));
    expect(b64).not.toMatch(/[\r\n]/);
    expect(Buffer.from(b64, 'base64').subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});
