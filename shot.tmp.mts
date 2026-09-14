import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-webgpu'] });
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => (globalThis as never as Record<string, unknown>)['__VERBO__'], null, { timeout: 60000 });
const utterance = 'un avion de pasajeros volando sobre la ciudad';
await page.evaluate(async (u) => {
  const api = (globalThis as never as Record<string, { say(s: string): Promise<unknown> }>)['__VERBO__']!;
  await api.say(u);
}, utterance);
await page.waitForTimeout(6000);
const log = await page.evaluate(() => [...document.querySelectorAll('.log-line, .line, li')].map((n) => n.textContent ?? '').filter((t) => t.includes('L3')));
for (const l of log) console.log('L3>', l.slice(0, 220));
await page.screenshot({ path: process.argv[2] ?? '/tmp/fig.png' });
await b.close();
