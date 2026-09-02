import { defineConfig } from 'vite';

export default defineConfig({
  // Top-level await in main.ts: renderer.init() must resolve before the first frame
  // (R-5), and awaiting it at module scope is the honest way to say so.
  build: { target: 'esnext' },
  esbuild: { target: 'esnext' },
  server: { port: 5173 },
});
