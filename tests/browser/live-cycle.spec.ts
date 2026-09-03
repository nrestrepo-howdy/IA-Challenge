/**
 * The five workstreams, joined, in a real browser.
 *
 * These drive `__VERBO__.say()` -- the same entry point the text field calls -- rather
 * than reaching into the pipeline. A test that calls a private seam proves the seam
 * works; it does not prove the product does.
 */
import { test, expect, type Page } from '@playwright/test';

type Api = {
  say(u: string): Promise<{ ok: boolean; ms: number }>;
  capture(): Promise<ImageData>;
  world: { state: Record<string, unknown> };
  loader: { residentCount: number };
};

/** Throws rather than returning undefined: a missing API is a boot failure, not a skip. */
function api(): Api {
  const a = (globalThis as never as Record<string, Api | undefined>)['__VERBO__'];
  if (!a) throw new Error('__VERBO__ is absent: the app did not finish booting');
  return a;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#status')).not.toHaveText('starting', { timeout: 30_000 });
}

test.describe('AC-18 · "make it rain" completes the full cycle', () => {
  test('utterance to injected state, within budget', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await boot(page);

    const result = await page.evaluate(() => {
      const a = (globalThis as never as Record<string, Api>)['__VERBO__']!;
      return a.say('make it rain');
    });

    expect(errors, `page errors: ${errors.join('; ')}`).toEqual([]);
    expect(result.ok).toBe(true);
    // R-8. The deterministic generator is far under this; the budget is what the
    // model-backed generator will have to live inside, so it is asserted from the start.
    expect(result.ms).toBeLessThan(40_000);

    // The verb reached the live world, not just the cycle's return value.
    const rain = await page.evaluate(() =>
      (globalThis as never as Record<string, Api>)['__VERBO__']!.world.state['weather']);
    expect(rain).toBeTruthy();
  });

  test('an impossible request is explained rather than attempted (AC-17)', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() =>
      (globalThis as never as Record<string, Api>)['__VERBO__']!.say('summon a sentient octopus'));
    expect(r.ok).toBe(false);
    await expect(page.locator('#log .reject').first()).toBeVisible();
  });
});

test.describe('AC-14 · the world never renders a black frame during an injection', () => {
  test('every sampled frame across the injection has content', async ({ page }) => {
    await boot(page);

    const samples = await page.evaluate(async () => {
      const a = (globalThis as never as Record<string, Api | undefined>)['__VERBO__'];
      if (!a) throw new Error('__VERBO__ is absent: the app did not finish booting');
      const seen: number[] = [];

      const sample = async (): Promise<void> => {
        const { data } = await a.capture();
        let nonBlack = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i]! > 8 || data[i + 1]! > 8 || data[i + 2]! > 8) nonBlack++;
        }
        seen.push(nonBlack / (data.length / 4));
      };

      // The deterministic generator finishes in milliseconds, so sampling only for
      // the duration of say() would capture a single frame and prove nothing. The
      // window deliberately spans before, during and after: a torn frame would land
      // somewhere in it, and 'somewhere' is the whole point of the criterion.
      for (let i = 0; i < 8; i++) await sample();
      const during = a.say('make it rain');
      for (let i = 0; i < 20; i++) await sample();
      const r = await during;
      for (let i = 0; i < 8; i++) await sample();

      return { frames: seen, ok: r.ok };
    });

    expect(samples.ok).toBe(true);
    expect(samples.frames.length).toBeGreaterThan(5);
    expect(Math.min(...samples.frames)).toBeGreaterThan(0.05);
  });

  test('injection is bounded: the resident module count is what the budget limits', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.loader.residentCount);
    await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.say('make it rain'));
    const after = await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.loader.residentCount);
    // R-4: module records can never be freed, so this only ever grows. Asserting the
    // growth is real is how the budget stays honest rather than decorative.
    expect(after).toBeGreaterThan(before);
  });
});

test.describe('AC-20 · a world survives a link', () => {
  test('the URL records the verbs, and opening it rebuilds the world', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.say('make it rain'));

    const shared = page.url();
    expect(shared).toMatch(/#v1:/);

    // A different page, given only the link.
    const fresh = await page.context().newPage();
    await fresh.goto(shared);
    await expect(fresh.locator('#status')).not.toHaveText('starting', { timeout: 30_000 });
    await expect(fresh.locator('#log .accept').first()).toBeVisible({ timeout: 30_000 });

    const state = await fresh.evaluate(() =>
      (globalThis as never as Record<string, Api>)['__VERBO__']!.world.state['weather']);
    expect(state).toBeTruthy();
    await fresh.close();
  });

  test('the link carries intent, not code', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.say('make it rain'));
    const hash = new URL(page.url()).hash;
    const decoded = Buffer.from(
      hash.replace('#v1:', '').replace(/-/g, '+').replace(/_/g, '/'), 'base64',
    ).toString('utf8');
    // There is no way to hand someone a Verbo link that injects code into their
    // browser, because the link never contains any.
    expect(decoded).toBe(JSON.stringify(['make it rain']));
    expect(decoded).not.toMatch(/import|function|=>|mount/);
  });
});
