import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-webgpu'] });
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => (globalThis as never as Record<string, unknown>)['__VERBO__'], null, {
  timeout: 60000,
});
await page.evaluate(async () => {
  const api = (globalThis as never as Record<string, { say(s: string): Promise<unknown> }>)['__VERBO__']!;
  await api.say('un avion volando sobre la ciudad');
});
await page.waitForTimeout(3500);
const rows = await page.evaluate(() => {
  const st = (globalThis as never as Record<string, Record<string, Record<string, unknown>>>)['__VERBO_STATE__']!;
  const out: string[] = [];
  for (const [name, slice] of Object.entries(st['figures'] ?? {})) {
    const pose = (slice as { pose?: number[] }).pose ?? [];
    const ys: number[] = [];
    for (let i = 1; i < pose.length; i += 7) ys.push(pose[i]!);
    if (ys.length === 0) continue;
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    out.push(`${name}: ${ys.length} parts, y ${lo.toFixed(0)}..${hi.toFixed(0)} authored = ${(lo * 0.045).toFixed(1)}..${(hi * 0.045).toFixed(1)} m`);
  }
  return out;
});
for (const r of rows) console.log(r);
await b.close();
