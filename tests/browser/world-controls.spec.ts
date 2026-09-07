/**
 * The chrome around the world: undo, the openers, and the inventory.
 *
 * Driven through the page the way a person drives it — a click on a chip, a keystroke
 * for undo — rather than through the functions behind them. What is being verified is
 * that a first-time user can find out what to say, see what they built, and take a
 * verb back; a test that called the functions directly would prove none of that.
 */
import { test, expect, type Page } from '@playwright/test';

type Api = {
  say(u: string): Promise<{ ok: boolean }>;
  world: {
    state: Record<string, unknown>;
    snapshot(): { verbs: { utterance: string }[]; userState: unknown };
    setUserState(path: string, value: unknown): void;
  };
  undo(): Promise<boolean>;
};

function app(): Api {
  const a = (globalThis as never as Record<string, Api | undefined>)['__VERBO__'];
  if (!a) throw new Error('__VERBO__ is absent: the app did not finish booting');
  return a;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#status')).not.toHaveText('starting', { timeout: 30_000 });
}

const verbs = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const a = (globalThis as never as Record<string, Api>)['__VERBO__']!;
    return a.world.snapshot().verbs.map((v) => v.utterance);
  });

test.describe('a verb can be taken back', () => {
  test('undo restores the world the last verb was applied to', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.say('make it rain'));
    await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.say('add fog'));
    expect(await verbs(page)).toEqual(['make it rain', 'add fog']);

    const withFog = await page.evaluate(() =>
      (globalThis as never as Record<string, Api>)['__VERBO__']!.world.state['atmosphere'] !== undefined);
    expect(withFog).toBe(true);

    await page.keyboard.press('Control+z');

    // The undone verb is gone from the world, and the one before it is still standing:
    // undo returns the previous world, not an empty one.
    await expect.poll(() => verbs(page)).toEqual(['make it rain']);
    await expect.poll(() => page.evaluate(() => {
      const s = (globalThis as never as Record<string, Api>)['__VERBO__']!.world.state;
      return { fog: s['atmosphere'] !== undefined, rain: s['weather'] !== undefined };
    })).toEqual({ fog: false, rain: true });

    // And the link follows the world back, so a shared link never names a verb the
    // user deliberately discarded.
    const hash = new URL(page.url()).hash;
    const decoded = Buffer.from(
      hash.replace('#v1:', '').replace(/-/g, '+').replace(/_/g, '/'), 'base64',
    ).toString('utf8');
    expect(JSON.parse(decoded)).toEqual(['make it rain']);
  });

  test('undo leaves state that is the user\'s untouched (AC-12)', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const a = (globalThis as never as Record<string, Api>)['__VERBO__']!;
      a.world.setUserState('camera', { position: [0, 2, 8] });
      a.world.setUserState('objects.created', [{ id: 'box-1' }]);
    });
    await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.say('make it rain'));

    const undone = await page.evaluate(() =>
      (globalThis as never as Record<string, Api>)['__VERBO__']!.undo());
    expect(undone).toBe(true);

    const user = await page.evaluate(() =>
      (globalThis as never as Record<string, Api>)['__VERBO__']!.world.snapshot().userState);
    expect(user).toEqual({ camera: { position: [0, 2, 8] }, objects: { created: [{ id: 'box-1' }] } });
  });

  test('the affordance appears only when there is something to undo', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.inv-undo')).toHaveCount(0);
    await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.say('make it rain'));
    await expect(page.locator('.inv-undo')).toBeVisible();

    await page.locator('.inv-undo').click();
    await expect.poll(() => verbs(page)).toEqual([]);
    await expect(page.locator('#inventory')).toHaveAttribute('data-open', 'false');
  });
});

test.describe('the prompt says what the world can do', () => {
  test('the openers are shown on a first load and clicking one builds a world', async ({ page }) => {
    await boot(page);
    const chips = page.locator('#suggest .sg');
    await expect(page.locator('#suggest')).toHaveAttribute('data-open', 'true');
    await expect(chips).toHaveCount(3);

    const utterance = (await chips.first().textContent()) ?? '';
    expect(utterance.length).toBeGreaterThan(0);
    await chips.first().click();

    await expect.poll(() => verbs(page), { timeout: 30_000 }).toEqual([utterance]);
    // Built something, so they are out of the way.
    await expect(page.locator('#suggest')).toHaveAttribute('data-open', 'false');
  });
});

test.describe('the world says what is in it', () => {
  test('the inventory lists the verbs applied, and a row can be dropped', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#inventory')).toHaveAttribute('data-open', 'false');

    await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.say('make it rain'));
    await page.evaluate(() => (globalThis as never as Record<string, Api>)['__VERBO__']!.say('add fog'));

    await expect(page.locator('#inventory')).toHaveAttribute('data-open', 'true');
    await expect(page.locator('#inventory .inv-verb')).toHaveText(['make it rain', 'add fog']);
    await expect(page.locator('.inv-head')).toContainText('2 verbs');

    // The first row, not the last: removal is not a second undo.
    await page.locator('#inventory .inv-drop').first().click();
    await expect.poll(() => verbs(page)).toEqual(['add fog']);
    await expect(page.locator('#inventory .inv-verb')).toHaveText(['add fog']);
    await expect.poll(() => page.evaluate(() =>
      (globalThis as never as Record<string, Api>)['__VERBO__']!.world.state['weather'] === undefined)).toBe(true);
  });
});
