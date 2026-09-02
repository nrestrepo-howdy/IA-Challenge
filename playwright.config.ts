import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  // One worker: every test here measures frame timing, and parallel workers on one
  // GPU would make AC-02 a measurement of scheduling rather than of the scene.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      args: [
        // WebGPU is off by default in headless Chromium. Without these the suite
        // would silently measure the WebGL2 fallback and report it as WebGPU --
        // a green run that verifies the wrong backend (R-3 territory).
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,UseSkiaRenderer',
        '--use-angle=default',
        '--enable-unsafe-swiftshader',
      ],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
