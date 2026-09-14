/**
 * The structural verbs, on screen.
 *
 * A primitive with a passing contract and no binding changes nothing a user can see,
 * and L2 cannot tell the difference: it decides correctness over hidden state (D-1),
 * which is exactly the property that makes it blind to the question "did anything
 * appear". So that question is asked here, in a real browser, through the same `say()`
 * entry point a person uses. Pixels are read back through the app's in-loop capture
 * rather than screenshotted, because presentation does not survive the frame and in
 * headless never reaches the compositor at all (R-3).
 *
 * A whole-frame pixel diff was tried first and is useless here: the base scene's camera
 * orbits, so six idle seconds move more pixels than a tower does, and the measurement
 * answers "did the camera move" for every verb. What works is a metric per verb that
 * the orbit leaves alone — silhouette coverage for the two that add geometry, the
 * ground's red-minus-blue for the one that changes what the world is made of — each
 * compared against a control sampled from the same page moments before the verb.
 */
import { test, expect, type Page } from '@playwright/test';

type Api = {
  say(u: string): Promise<{ ok: boolean; ms: number; reason: string | null }>;
  capture(): Promise<ImageData>;
  world: { state: Record<string, unknown> };
};

interface Metrics {
  /** Pixels dark enough to be silhouette rather than sky. More geometry, more of them. */
  readonly dark: number;
  /**
   * Summed height of the silhouette: for every column, how far above the bottom of the
   * frame the city first appears, added up.
   *
   * `dark` is an *area* proxy, and it stopped having room in it. When every building
   * was a solid box, doubling the city's density and height added 1.8x the dark pixels;
   * with setbacks and tapers, the same verb adds mass lower down and takes it away
   * higher up, and the same real change measures 1.23x against a threshold of 1.25.
   * The honest reading of that is not that the verb stopped working — it is that the
   * metric was measuring a side effect of the old geometry.
   *
   * This measures what `skyline-shift` actually does: it makes the skyline taller. The
   * same change is 1.76x here, against 1.0x for a verb that did nothing, which is the
   * headroom an assertion needs to still be an assertion.
   */
  readonly skyline: number;
  /** Mean red-minus-blue over the bottom of the frame: what the ground is made of. */
  readonly groundRB: number;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#status')).not.toHaveText('starting', { timeout: 30_000 });
}

const VERBS = [
  {
    utterance: 'raise a tower',
    note: 'a tower rises out of the ground',
    slice: 'structures',
    // Observed 1.56x against the control; asserted well under it, because this runs on
    // whatever backend the machine has and a tight bound would measure the GPU.
    check: (control: Metrics, after: Metrics) => expect(after.dark).toBeGreaterThan(control.dark * 1.25),
  },
  {
    utterance: 'a taller denser city',
    note: 'the authored skyline is rescaled',
    slice: 'structures',
    // Both words in the verb, each with its own bound, and this is the end of a habit
    // rather than another recalibration.
    //
    // `dark` — silhouette area — was calibrated at 1.8x against flat-shaded solid boxes,
    // cut to 1.25x when rim lighting lifted every building edge, and fell to 1.23x when
    // buildings gained setbacks that add mass low and remove it high. So the metric
    // moved to skyline *height*, which measured 1.76x. Then the city was laid out on a
    // street grid, and the two swapped places: density now fills blocks rather than
    // scattering towers, so area went to 2.30x and height fell to 1.35x.
    //
    // Chasing whichever number happens to be highest is how a test becomes a formality.
    // "A taller denser city" is two claims, so it gets two assertions: more silhouette
    // *area* because it is denser, and a higher *skyline* because it is taller. Bounds
    // at 1.6x and 1.2x against measurements of 2.30x and 1.35x, and a verb that did
    // nothing lands at 1.0x on both.
    check: (control: Metrics, after: Metrics) => {
      expect(after.dark, 'denser: more silhouette').toBeGreaterThan(control.dark * 1.6);
      expect(after.skyline, 'taller: a higher skyline').toBeGreaterThan(control.skyline * 1.2);
    },
  },
  {
    utterance: 'make it a desert',
    note: 'the ground changes material',
    slice: 'surface',
    // Wet asphalt is blue-negative; sand is not. The sign flip is the picture.
    check: (control: Metrics, after: Metrics) =>
      expect(after.groundRB - control.groundRB).toBeGreaterThan(4),
  },
] as const;

test.describe('structural verbs are visible, not merely contracted', () => {
  for (const verb of VERBS) {
    test(`"${verb.utterance}" — ${verb.note}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await boot(page);

      const observed = await page.evaluate(async (utterance) => {
        const api = (globalThis as never as Record<string, Api>)['__VERBO__']!;
        const measure = (frame: ImageData): Metrics => {
          const { data, width: w, height: h } = frame;
          let dark = 0, groundR = 0, groundB = 0, groundN = 0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
              if (r + g + b < 24) dark++;
              if (y > h * 0.7) { groundR += r; groundB += b; groundN++; }
            }
          }
          // Column by column, top down, to the first silhouette pixel. A column with no
          // city in it contributes nothing rather than a full-height zero, so widening
          // the skyline counts as well as raising it — which is what "denser" means.
          let skyline = 0;
          for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
              const i = (y * w + x) * 4;
              if (data[i]! + data[i + 1]! + data[i + 2]! < 24) { skyline += h - y; break; }
            }
          }
          return { dark, skyline, groundRB: (groundR - groundB) / Math.max(1, groundN) };
        };

        // The control is taken after several seconds of idle orbit, so it carries the
        // camera drift the verb's own frame will also carry.
        await new Promise((r) => setTimeout(r, 4_000));
        const control = measure(await api.capture());
        const result = await api.say(utterance);
        // The rise, the shift and the cross-fade are all eased over a couple of seconds
        // on purpose — a structure that pops reads as a glitch — so this settles for
        // longer than the ease and measures the finished world.
        await new Promise((r) => setTimeout(r, 3_500));
        return { result, control, after: measure(await api.capture()) };
      }, verb.utterance);

      expect(errors, `page errors: ${errors.join('; ')}`).toEqual([]);
      expect(observed.result.reason ?? '', 'the verb was rejected').toBe('');
      expect(observed.result.ok).toBe(true);
      // The verb reached the live world, not just the cycle's return value.
      expect(await page.evaluate((k) =>
        (globalThis as never as Record<string, Api>)['__VERBO__']!.world.state[k], verb.slice)).toBeTruthy();

      // The binding is what this line asserts. Without one the state would be perfect
      // and the picture identical, which is precisely the failure L2 cannot see.
      verb.check(observed.control, observed.after);
    });
  }
});
