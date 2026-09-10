import { defineConfig } from 'vite';
// @ts-expect-error - plain ESM plugin, no types
import { modelProxy } from './tools/serve/model-proxy.mjs';

export default defineConfig({
  plugins: [modelProxy()],
  // GitHub Pages serves from /<repo>/, local dev from /. Reading it from the
  // environment keeps one build config for both instead of a committed value that is
  // wrong in whichever place it was not written for.
  base: process.env['VERBO_BASE'] ?? '/',
  // Top-level await in main.ts: renderer.init() must resolve before the first frame
  // (R-5), and awaiting it at module scope is the honest way to say so.
  build: { target: 'esnext' },
  esbuild: { target: 'esnext' },
  server: { port: 5173 },
});
