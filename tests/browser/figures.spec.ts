/**
 * The freeform surface, on screen (AC-21).
 *
 * This is the one capability whose correctness cannot be established by construction.
 * Every other verb composes parameters a schema already validated, so "did it work" is
 * answerable before anything runs; a rig carries a `pose` that was *written*, and the
 * only honest answer to whether it arrived is a frame.
 *
 * The two halves of AC-21 are verified in two places on purpose, and the split is the
 * same one D-1 makes everywhere else. That the rig **moves** is a claim about hidden
 * state, and it is decided by the contract — `tests/intent/figures.test.ts` builds a
 * real contract and shows it failing on a rig whose pose is identical between frames,
 * which is the T-pose failure this surface risks. That the rig is **on screen** is a
 * claim about pixels, and only a browser can answer it. This file answers the second.
 *
 * Pixels come through the app's in-loop capture rather than a screenshot: presentation
 * does not survive the frame, and in headless it never reaches the compositor (R-3).
 */
import { test, expect, type Page } from '@playwright/test';

type Api = {
  say(u: string): Promise<{ ok: boolean; reason: string | null; unaddressed?: string[] }>;
  capture(): Promise<ImageData>;
  world: { state: Record<string, unknown> };
};

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#status')).not.toHaveText('starting', { timeout: 30_000 });
}

/**
 * Pixels that differ beyond the faintest, as source for the page.
 *
 * A threshold rather than an exact compare because the base scene is never still — the
 * camera orbits, the windows breathe — and because the facade is fine enough that a
 * sub-pixel camera shift changes tens of thousands of pixels on its own. That is why
 * nothing here is measured against zero: every number is measured against the same
 * world over the same interval without the verb.
 */
const DIFF = `(a, b) => {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i])
      + Math.abs(a.data[i + 1] - b.data[i + 1])
      + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > 24) n++;
  }
  return n;
}`;

test.describe('a rig the catalogue cannot express (AC-21)', () => {
  test('reaches the world and changes the picture', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await boot(page);

    const observed = await page.evaluate(async (diffSource) => {
      const api = (globalThis as never as Record<string, Api>)['__VERBO__']!;
      const diff = eval(diffSource) as (a: ImageData, b: ImageData) => number;
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

      // The control: how much this world changes on its own over the same interval the
      // verb is given. Without it the assertion below would be a number chosen to pass.
      await wait(5_000);
      const idleA = await api.capture();
      await wait(2_000);
      const idleB = await api.capture();
      const idleMotion = diff(idleA, idleB);

      const before = await api.capture();
      const result = await api.say('un perro con una persona paseando');
      // Long enough for the camera to finish reframing: a rig pulls the viewpoint in,
      // and the ease is deliberately slow so the move reads as the world settling.
      await wait(6_000);
      const after = await api.capture();

      return {
        result,
        slices: Object.keys((api.world.state as Record<string, unknown>)['figures'] ?? {}),
        changed: diff(before, after),
        idleMotion,
      };
    }, DIFF);

    expect(errors, `page errors: ${errors.join('; ')}`).toEqual([]);
    expect(observed.result.reason ?? '', 'the verb was rejected').toBe('');
    expect(observed.result.ok).toBe(true);

    // It reached the live world under its own name, and claimed the words that selected
    // it rather than reporting them as beyond the catalogue.
    expect(observed.slices).toContain('dog-walker');
    expect(observed.result.unaddressed ?? []).toEqual([]);

    // And the picture is not the picture it would have been. Measured at 2.26x the
    // control; asserted at 1.8x, because this runs on whatever backend the machine has
    // and a tight bound would be measuring the GPU rather than the verb.
    //
    // What this does *not* separate is the rig from the reframing it caused, and that
    // is stated rather than hidden: the camera moves in because a figure entered the
    // world, so both are evidence of the same event, and neither happens if the rig
    // never mounted.
    expect(observed.changed).toBeGreaterThan(observed.idleMotion * 1.8);
  });
});
