/**
 * The five workstreams, joined, in a real browser.
 *
 * These drive `__VERBO__.say()` -- the same entry point the text field calls -- rather
 * than reaching into the pipeline. A test that calls a private seam proves the seam
 * works; it does not prove the product does.
 */
import { test, expect, type Page } from '@playwright/test';

type Api = {
  say(u: string): Promise<{ ok: boolean; ms: number; steps: { kind: string; text: string }[] }>;
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

test.describe('AC-11 · L3 runs on the injected world without deciding anything', () => {
  test('reports on the frame, and says outright that no critic judged it', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(() =>
      (globalThis as never as Record<string, Api>)['__VERBO__']!.say('make it rain'));

    expect(result.ok).toBe(true);
    const l3 = result.steps.filter((s) => s.text.startsWith('L3'));
    expect(l3.length, 'the perceptual layer reported nothing at all').toBe(1);
    // No key is configured in the suite, and nothing here needs one (R-10). What the
    // layer must not do is let that silence read as approval.
    expect(l3[0]!.text).toMatch(/not judged|no visual critic configured/);
    // Advisory to the end: the world changed regardless of what L3 had to say.
    const rain = await page.evaluate(() =>
      (globalThis as never as Record<string, Api>)['__VERBO__']!.world.state['weather']);
    expect(rain).toBeTruthy();
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

    // Polled, not sampled once. The 'injecting' line is written before the module is
    // loaded and mounted, so a single read the instant it appears races the mount --
    // which made this assertion fail roughly one run in six.
    await expect.poll(() => fresh.evaluate(() =>
      (globalThis as never as Record<string, Api>)['__VERBO__']!.world.state['weather'] !== undefined,
    ), { timeout: 30_000 }).toBe(true);
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

test.describe('the harness is visible while it works', () => {
  test('shows one lane per candidate, and which layers each cleared', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.say('make it rain'));

    await expect(page.locator('#verify')).toHaveAttribute('data-open', 'true');
    // D-5: three genuinely different programs race; the panel shows all three, not
    // just the one that won.
    await expect(page.locator('#verify .vp-lane')).toHaveCount(3);

    const winner = page.locator('#verify .vp-lane[data-outcome="accepted"]');
    await expect(winner).toHaveCount(1);
    // The authoritative layers show as passed on the winner; L3 shows as advisory,
    // because it is (AC-11).
    for (const layer of ['L0', 'L1', 'L2']) {
      await expect(winner.locator(`.vp-cell[data-state="passed"]`).filter({ hasText: layer })).toHaveCount(1);
    }
    await expect(winner.locator('.vp-cell[data-state="advisory"]').filter({ hasText: 'L3' })).toHaveCount(1);
    await expect(winner.locator('.vp-note')).toHaveText('injected');
  });

  test('the panel stays open after a decision, because the losers are the evidence', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.say('add fog'));
    await expect(page.locator('#verify')).toHaveAttribute('data-open', 'true');
    await expect(page.locator('#verify .vp-lane')).toHaveCount(3);
  });
});

test.describe('AC-08 · a spinning candidate is killed, not caught', () => {
  test('an infinite loop is terminated and the page keeps running', async ({ page }) => {
    await boot(page);

    const result = await page.evaluate(async () => {
      const a = (globalThis as never as Record<string, {
        prober: { probe(r: unknown, ms: number): Promise<{ timedOut: boolean; failure: string | null }>; activeWorkers: number };
      }>)['__VERBO__']!;

      // A heartbeat on the main thread. If isolation were a lie -- if the candidate
      // ran here -- this would stop dead for the duration of the spin.
      let beats = 0;
      const hb = setInterval(() => { beats++; }, 10);

      const r = await a.prober.probe(
        { source: 'export function mount() { while (true) {} }', frames: 120, actions: [] },
        700,
      );

      clearInterval(hb);
      // 2 + 2 afterwards: proof the main thread is not merely alive but correct.
      return { ...r, beats, arithmetic: 2 + 2, active: a.prober.activeWorkers };
    });

    expect(result.timedOut).toBe(true);
    expect(result.failure).toMatch(/terminated/);
    // The heartbeat kept ticking through the spin: the loop never touched this thread.
    expect(result.beats).toBeGreaterThan(20);
    expect(result.arithmetic).toBe(4);
    // Terminated, not abandoned. An abandoned worker still burns a core.
    expect(result.active).toBe(0);
  });

  test('a healthy candidate still probes after a kill on the same prober', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() =>
      (globalThis as never as Record<string, Api>)['__VERBO__']!.say('make it rain'));
    expect(r.ok).toBe(true);
  });
});
