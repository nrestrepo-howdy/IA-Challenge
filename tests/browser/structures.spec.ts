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
    // Was 1.8x. The cinematic pass added rim lighting and bloom, which raise the value
    // of every building edge — so the same extra geometry now produces fewer pixels
    // below the silhouette threshold. The metric still measures the right thing; the
    // multiplier was calibrated against flat shading.
    //
    // 1.25x is still a real assertion: a skyline-shift that did nothing lands at 1.0x,
    // and the measured value with the new renderer is 1.33x. Loosening it further would
    // turn a measurement into a formality.
    check: (control: Metrics, after: Metrics) => expect(after.dark).toBeGreaterThan(control.dark * 1.25),
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
          return { dark, groundRB: (groundR - groundB) / Math.max(1, groundN) };
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
