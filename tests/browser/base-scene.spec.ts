/**
 * Browser-level acceptance for the base scene.
 *
 * These are the criteria that cannot be checked in Node, and they are also the seam
 * the L3 perceptual oracle will reuse: the pixel readback here is the same mechanism
 * the shadow renderer needs (R-3 -- canvas presentation never reaches the compositor
 * in headless, so pixels are read back rather than screenshotted from the compositor).
 */
import { test, expect, type Page } from '@playwright/test';

/**
 * Reads pixels back through the app's own in-loop capture.
 *
 * An earlier version drew the canvas from outside the loop and always got zero
 * non-black pixels while the scene was demonstrably rendering -- presentation does
 * not survive the frame, and in headless it never reaches the compositor (R-3). The
 * app captures where the pixels exist; the test asks it to.
 */
async function readback(page: Page): Promise<{ nonBlack: number; total: number }> {
  return page.evaluate(async () => {
    const api = (globalThis as never as Record<string, { capture(): Promise<ImageData> } | undefined>)['__VERBO__'];
    if (!api) throw new Error('__VERBO__ is absent: the app did not finish booting');
    const { data, width: w, height: h } = await api.capture();
    let nonBlack = 0;
    for (let i = 0; i < data.length; i += 4) {
      // A near-black threshold, not zero: a correctly rendered night scene is dark,
      // and testing for literal zero would pass a scene that renders nothing but
      // fail one that renders a moonlit sky.
      if (data[i]! > 8 || data[i + 1]! > 8 || data[i + 2]! > 8) nonBlack++;
    }
    return { nonBlack, total: w * h };
  });
}

test.describe('AC-01 · the base scene loads with a non-black first frame', () => {
  test('renders content once the renderer has initialised', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.locator('#status')).not.toHaveText('starting', { timeout: 30_000 });

    const { nonBlack, total } = await readback(page);
    expect(errors, `page errors: ${errors.join('; ')}`).toEqual([]);
    // R-5: skipping `await renderer.init()` is precisely how a black first frame
    // ships, and it is what L1 rejects candidates for.
    expect(nonBlack / total).toBeGreaterThan(0.05);
  });

  test('exposes __VERBO_STATE__ for contract assertions', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).not.toHaveText('starting', { timeout: 30_000 });
    expect(await page.evaluate(() => typeof (globalThis as never as Record<string, unknown>)['__VERBO_STATE__'])).toBe('object');
  });
});

test.describe('AC-03 · WebGL2 fallback', () => {
  test('falls back and still satisfies AC-01', async ({ page }) => {
    await page.goto('/?forceWebGL');
    await expect(page.locator('#status')).not.toHaveText('starting', { timeout: 30_000 });
    await expect(page.locator('body')).toHaveAttribute('data-backend', 'webgl2');

    const { nonBlack, total } = await readback(page);
    expect(nonBlack / total).toBeGreaterThan(0.05);
  });
});

test.describe('AC-02 · the base scene holds its frame budget', () => {
  test('median frame time stays under the budget over 10 s', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).not.toHaveText('starting', { timeout: 30_000 });

    const median = await page.evaluate(async () => {
      const samples: number[] = [];
      let last = performance.now();
      await new Promise<void>((resolve) => {
        const tick = (): void => {
          const now = performance.now();
          samples.push(now - last);
          last = now;
          if (samples.length >= 600) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      // Median, not mean: one compositor hitch would drag a mean past the budget
      // and fail a scene that is in fact smooth. Same reasoning as L1 (AC-06).
      const sorted = samples.slice(30).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)]!;
    });

    // 55 fps is 18.2 ms. Headless software rasterisation is slower than real
    // hardware, so this asserts the scene is not pathological; the SPEC figure is
    // measured on reference hardware.
    expect(median).toBeLessThan(34);
  });
});
