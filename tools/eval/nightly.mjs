#!/usr/bin/env node
/**
 * Nightly evaluation.
 *
 * Drives the real application through Playwright rather than re-implementing the
 * pipeline in Node. An evaluation that exercises a parallel copy of the system
 * measures the copy.
 *
 * Runs on a schedule because the interesting number is not tonight's pass rate: it is
 * the curve across nights as the system changes. That curve cannot be produced at the
 * end -- it needs elapsed time, which is the one input that cannot be bought with
 * effort. Hence it starts on day three rather than day ten.
 *
 *   node tools/eval/nightly.mjs            one pass over the corpus
 *   node tools/eval/nightly.mjs --repeat 3 three passes, for timing spread
 */
import { chromium } from '@playwright/test';
import { readFileSync, appendFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = join(ROOT, '.verbo/eval');
const corpus = JSON.parse(readFileSync(join(ROOT, 'tools/eval/corpus.json'), 'utf8'));
const repeat = Number(process.argv[process.argv.indexOf('--repeat') + 1]) || 1;
const URL_BASE = process.env.VERBO_URL ?? 'http://localhost:4173';

mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString();
const file = join(OUT, `${stamp.slice(0, 10)}.jsonl`);

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=default'],
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const results = [];
try {
  await page.goto(URL_BASE);
  await page.waitForFunction(() => globalThis.__VERBO__ !== undefined, { timeout: 60_000 });

  for (let pass = 0; pass < repeat; pass++) {
    for (const [group, utterances] of Object.entries(corpus)) {
      for (const utterance of utterances) {
        // A fresh page per utterance: injections are cumulative by design, and a
        // pass rate measured on a world that already has ten verbs in it is
        // measuring something else.
        await page.goto(URL_BASE);
        await page.waitForFunction(() => globalThis.__VERBO__ !== undefined, { timeout: 60_000 });
        const before = pageErrors.length;
        const r = await page.evaluate((u) => globalThis.__VERBO__.say(u), utterance);
        results.push({
          ts: new Date().toISOString(), pass, group, utterance,
          ok: r.ok, ms: Math.round(r.ms), rejectedAt: r.rejectedAt, reason: r.reason,
          // Recorded per row, not per run: a resolver that falls back mid-corpus would
          // otherwise be averaged into a number nobody could interpret afterwards.
          resolver: r.resolver ?? 'phrasebook',
          expected: group !== 'expectRejection',
          unaddressed: r.unaddressed ?? [],
          pageErrors: pageErrors.slice(before),
        });
      }
    }
  }
} finally {
  await browser.close();
}

for (const r of results) appendFileSync(file, JSON.stringify(r) + '\n');

// ── Summary ──────────────────────────────────────────────────────────────────
// A disclosure case must be accepted *and* say what it could not do. Counting it as
// a plain success would let the system regress back to silent partial fulfilment --
// the exact failure this category was created to catch.
//
// And the mirror of it: a success case must be accepted *silently*. Disclosure is a
// claim of failure, so a request the catalogue fully expresses that comes back saying
// it could not is wrong in the direction nobody checks. The 13 September run answered
// "a storm" with night, rain, wind and lightning -- and reported "a storm" as
// unaddressed, because no primitive happens to be named after it. Under the old rule
// that scored as a clean pass; there is no reading of it that is one.
const agreed = results.filter((r) =>
  r.group === 'expectDisclosure'
    ? r.ok && r.unaddressed.length > 0
    : r.expected
      ? r.ok && r.unaddressed.length === 0
      : r.ok === r.expected);
const times = results.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
const p = (q) => times.length ? times[Math.min(times.length - 1, Math.floor(times.length * q))] : 0;

const byLayer = {};
for (const r of results.filter((x) => !x.ok)) byLayer[r.rejectedAt ?? 'none'] = (byLayer[r.rejectedAt ?? 'none'] ?? 0) + 1;

console.log(`\nVerbo nightly · ${stamp}`);
console.log(`  corpus            ${results.length} utterances over ${repeat} pass(es)`);
console.log(`  behaved as expected ${agreed.length}/${results.length}`);
console.log(`  latency (p50/p95)   ${p(0.5)} ms / ${p(0.95)} ms   budget 40000 ms (R-8)`);
console.log(`  rejections by layer ${Object.entries(byLayer).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}`);

// Disagreements are printed in full. A summary that hides which utterance failed is
// a number nobody can act on, and the failures are the reason this runs at all.
const wrong = results.filter((r) => !agreed.includes(r));
if (wrong.length) {
  console.log(`\n  disagreements (${wrong.length}):`);
  for (const r of wrong) {
    const want = r.group === 'expectDisclosure' ? 'expected acceptance with a disclosure'
      : r.expected ? 'expected success with nothing disclosed' : 'expected rejection';
    const got = r.ok
      ? `accepted${r.unaddressed.length ? ` disclosing ${JSON.stringify(r.unaddressed)}` : ' silently'}`
      : `rejected at ${r.rejectedAt}`;
    console.log(`    ${want}: ${JSON.stringify(r.utterance)}  ->  ${got}${r.reason ? ` (${r.reason})` : ''}`);
  }
}

const nights = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith('.jsonl')).length : 0;
console.log(`\n  written to ${file.replace(ROOT, '')}  ·  ${nights} night(s) recorded\n`);
