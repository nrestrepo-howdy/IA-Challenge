#!/usr/bin/env node
/**
 * Acceptance-criteria gate - the executable half of the specification.
 *
 * Parses every AC out of docs/SPEC.md, then scans the test suite for references to
 * them. An AC that nothing tests is not "done" no matter what anyone claims; this is
 * the deterministic answer to the failure mode the rules call out by name --
 * "an agent that claims work is complete without meaningful verification".
 *
 *   node tools/evidence/ac-gate.mjs            report coverage
 *   node tools/evidence/ac-gate.mjs --strict   exit 1 if any AC is uncovered
 *
 * --strict is the definition-of-done gate. Day to day it reports, so a partially
 * built system stays legible rather than simply red.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const strict = process.argv.includes('--strict');

const spec = readFileSync(join(ROOT, 'docs/SPEC.md'), 'utf8');
const criteria = [...spec.matchAll(/^- \*\*(AC-\d+)\*\*\s+(.+)$/gm)]
  .map(([, id, text]) => ({ id, text: text.trim() }));

if (criteria.length === 0) {
  console.error('ac-gate: no acceptance criteria found in docs/SPEC.md');
  process.exit(1);
}

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(test|spec)\.ts$/.test(e)) files.push(p);
  }
})(join(ROOT, 'tests'));

const refs = new Map();
for (const f of files) {
  for (const [, id] of readFileSync(f, 'utf8').matchAll(/\b(AC-\d+)\b/g)) {
    if (!refs.has(id)) refs.set(id, new Set());
    refs.get(id).add(f.replace(ROOT, ''));
  }
}

const covered = criteria.filter((c) => refs.has(c.id));
const pending = criteria.filter((c) => !refs.has(c.id));
const pct = ((covered.length / criteria.length) * 100).toFixed(0);

console.log(`\nAcceptance criteria: ${covered.length}/${criteria.length} verified (${pct}%)\n`);
for (const c of covered) {
  console.log(`  [verified] ${c.id}  ${trunc(c.text)}`);
  for (const f of refs.get(c.id)) console.log(`               ${f}`);
}
if (pending.length) {
  console.log('\n  Not yet verified:');
  for (const c of pending) console.log(`  [ pending ] ${c.id}  ${trunc(c.text)}`);
}

// Orphans are worse than gaps: a test claiming an AC the spec no longer contains means
// the spec moved and the test was left asserting something nobody asked for.
const orphans = [...refs.keys()].filter((id) => !criteria.some((c) => c.id === id));
if (orphans.length) {
  console.error(`\nac-gate: tests reference unknown criteria: ${orphans.join(', ')}`);
  process.exit(1);
}

if (strict && pending.length) {
  console.error(`\nac-gate: ${pending.length} acceptance criteria have no verification. Not done.`);
  process.exit(1);
}
console.log('');

function trunc(s) { return s.length > 66 ? s.slice(0, 65) + '...' : s; }
