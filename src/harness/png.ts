/**
 * PNG encoding for captured frames, in about a hundred lines and no dependency.
 *
 * The critic needs an image and `Verdict.frame` is declared as a PNG, but the frame
 * arrives as raw RGBA. Two constraints rule out the obvious answers. The same code
 * runs in the browser (the live cycle captures in `main.ts`'s animation loop) and in
 * plain Node (the harness is deliberately testable without a GPU), so `node:zlib` and
 * `canvas.toBlob` are both out; and an image encoder pulled in for one 160x90
 * thumbnail per cycle is a dependency that has to be audited forever.
 *
 * So the DEFLATE stream is written with **stored blocks** -- valid, uncompressed
 * DEFLATE, which every PNG decoder accepts. It costs about 1 byte per 65 KB over the
 * raw bytes. That is the whole trade: an unbeatably boring encoder, and a frame that
 * is roughly 58 KB instead of roughly 2 KB. At one frame per accepted injection, on a
 * layer whose model call is seconds, not milliseconds (R-7), the bytes are not the
 * expensive part.
 */
import type { Frame } from './l3-perceptual.js';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0;
  // 5552 is the largest run that cannot overflow a 32-bit accumulator, so the modulo
  // is taken per chunk rather than per byte.
  for (let i = 0; i < bytes.length;) {
    const end = Math.min(i + 5552, bytes.length);
    for (; i < end; i++) { a += bytes[i]!; b += a; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** A zlib stream whose DEFLATE payload is entirely stored (BTYPE=00) blocks. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const MAX = 0xffff;
  const blocks = Math.max(1, Math.ceil(raw.length / MAX));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  let o = 0;
  out[o++] = 0x78; out[o++] = 0x01;              // CMF/FLG: deflate, 32K window, no dict
  for (let i = 0; i < blocks; i++) {
    const start = i * MAX;
    const len = Math.min(MAX, raw.length - start);
    out[o++] = i === blocks - 1 ? 1 : 0;         // BFINAL on the last block only
    out[o++] = len & 0xff; out[o++] = (len >>> 8) & 0xff;
    out[o++] = ~len & 0xff; out[o++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  new DataView(out.buffer).setUint32(o, adler32(raw));
  return out;
}

/**
 * Encodes an RGBA frame as an 8-bit truecolour-with-alpha PNG.
 *
 * Every scanline is written with filter type 0. Filtering exists to help the entropy
 * coder, and there is no entropy coder here.
 */
export function encodePng(frame: Frame): Uint8Array {
  const { width, height } = frame;
  const stride = width * 4;
  if (frame.data.length < stride * height) {
    throw new Error(`frame data is ${frame.data.length} bytes, short of ${stride * height} for ${width}x${height}`);
  }

  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(frame.data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const head = new DataView(ihdr.buffer);
  head.setUint32(0, width);
  head.setUint32(4, height);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: truecolour with alpha
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  return png;
}

/**
 * Base64 with no newlines, which the image content block requires.
 *
 * `Buffer` in Node, `btoa` in the browser: this file is imported by both, and the
 * bundler must not be handed a `node:buffer` import to shim.
 */
export function toBase64(bytes: Uint8Array): string {
  const g = globalThis as {
    Buffer?: { from(b: Uint8Array): { toString(enc: string): string } };
    btoa?: (s: string) => string;
  };
  if (g.Buffer) return g.Buffer.from(bytes).toString('base64');
  let binary = '';
  // Chunked: String.fromCharCode with ~58k arguments overflows the argument stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  if (!g.btoa) throw new Error('no base64 encoder available in this environment');
  return g.btoa(binary);
}
