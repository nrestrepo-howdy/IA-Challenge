#!/usr/bin/env node
/**
 * Mutation audit of the test suite itself.
 *
 * The harness has now been wrong about itself twice, both times the same way: a layer
 * reporting success on a weaker statement than the one written down, and its own tests
 * agreeing because they were written from the same understanding. A test written from
 * the same blind spot as the code inherits it.
 *
 * So this breaks load-bearing code on purpose and asks which tests notice. A mutation
 * that SURVIVES is the finding: it names a line nothing is actually holding.
 *
 *   node tools/evidence/mutate-suite.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;

/** Each mutation names a promise the project makes. */
const MUTATIONS = [
  ['src/harness/cascade.ts', "return !AUTHORITATIVE_LAYERS.includes(v.failedAt);", "return true;",
   'AC-11 · a failed authoritative layer no longer blocks injection'],
  // The first version of this mutation left the real sort in place after the noise,
  // so it changed nothing and "survived" for the wrong reason. A mutation that does
  // not mutate reports the suite as weak when it is the audit that is weak — the same
  // failure the mutation engine itself had in June.
  ['src/harness/cascade.ts',
   "  const ordered = [...oracles].sort(\n    (a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer),\n  );",
   "  const ordered = [...oracles];",
   'cascade · layers no longer run cheapest-first'],
  ['src/harness/mutation.ts', "if (!outcome.passed && outcome.failedIds.includes(mutant.mustBeCaughtBy)) caught.push(mutant.id);",
   "if (!outcome.passed) caught.push(mutant.id);",
   'AC-10 · a contract that catches a defect by accident now counts as sound'],
  ['src/harness/l2-contract.ts', "return deepEqual(prior, value)", "return false ? deepEqual(prior, value)",
   'AC-09 · changesOverTime stops detecting an inert value'],
  ['src/harness/l3-perceptual.ts', "if (delta.changed < minChanged) {", "if (false) {",
   'L3 · a candidate that renders nothing is no longer flagged'],
  ['src/core/world.ts', "throw new PathOwnershipError(", "void 0 ?? new PathOwnershipError(",
   'core · two primitives may now own the same state path'],
  ['src/runtime/generate.ts', "params[adjustment.param] = clampToSchema(", "params[adjustment.param] = ((a,b,c)=>c)(",
   'repair · a repaired parameter may leave its declared range'],
];

const run = () => {
  try {
    execSync('npx vitest run --silent', { cwd: ROOT, stdio: 'pipe' });
    return true;   // suite passed => the mutation went unnoticed
  } catch {
    return false;  // something failed => the mutation was caught
  }
};

console.log('\nMutation audit — a SURVIVOR names a line nothing is holding\n');
const survivors = [];
for (const [file, from, to, promise] of MUTATIONS) {
  const path = join(ROOT, file);
  const original = readFileSync(path, 'utf8');
  if (!original.includes(from)) {
    console.log(`  [ stale  ] ${promise}\n             pattern not found in ${file}`);
    survivors.push(promise + ' (stale pattern)');
    continue;
  }
  writeFileSync(path, original.replace(from, to));
  const survived = run();
  writeFileSync(path, original);
  console.log(`  [${survived ? 'SURVIVED' : ' caught '}] ${promise}`);
  if (survived) survivors.push(promise);
}

console.log(`\n  ${MUTATIONS.length - survivors.length}/${MUTATIONS.length} caught`);
if (survivors.length) {
  console.log('\n  Unheld:');
  for (const s of survivors) console.log(`    - ${s}`);
  process.exit(1);
}
console.log('');
