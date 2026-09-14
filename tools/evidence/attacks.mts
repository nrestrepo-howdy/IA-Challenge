/**
 * The attack corpus, run against the real boundaries and printed.
 *
 * `tests/harness/l0-escapes.test.ts` asserts the same set. This prints it, for the same
 * reason `evidence:loop` exists: a passing test says something was checked, not what
 * happened, and the interesting part of this one is the *shape* of the result — that
 * four of twelve are not caught by the lint, on purpose, and are stopped by something
 * else entirely.
 *
 *   npm run attack
 */
import { analyze } from '../../src/harness/l0-static.js';
import { ATTACKS } from '../../src/harness/attacks.js';
import { makeIntent } from '../../tests/fixtures.js';

const intent = makeIntent({ scope: ['weather.rain'], allowedPrimitives: ['rain-emitter'] });

/** The capabilities `revokeCapabilities()` deletes from the worker before import. */
const REVOKED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts',
  'Notification', 'indexedDB', 'caches', 'BroadcastChannel', 'SharedWorker', 'Worker',
];

console.log(`
  Verbo · what the harness refuses
  the corpus in src/harness/attacks.ts, run against L0 and reported

  L0 is a lint over the AST. It is not a sandbox and its own docstring says so: twelve
  escapes were written against it and twelve passed, which is why the boundary moved
  into the probe worker, where the capability is deleted rather than objected to.
`);

let caught = 0;
let byDesign = 0;

for (const attack of ATTACKS) {
  const findings = analyze(attack.source, intent);
  const blocked = findings.length > 0;
  const expected = attack.caughtBy === 'L0';

  if (blocked !== expected) {
    console.error(`  MISMATCH  ${attack.name}: expected ${attack.caughtBy ?? 'not caught'}, L0 ${blocked ? 'caught' : 'missed'} it`);
    process.exitCode = 1;
    continue;
  }

  if (blocked) {
    caught += 1;
    console.log(`  L0        ${attack.name.padEnd(30)} ${findings[0]?.rule ?? ''}`);
  } else {
    byDesign += 1;
    console.log(`  worker    ${attack.name.padEnd(30)} ${attack.intent}`);
  }
}

console.log(`
  ${caught} refused by the lint, ${byDesign} left to the worker — which is the claim.

  The ${byDesign} the lint misses build a function from a string without ever naming
  \`eval\`, so there is no identifier to object to. They are stopped by deletion instead:
  the worker removes ${REVOKED.length} globals before the candidate is imported —
  ${REVOKED.slice(0, 4).join(', ')} and ${REVOKED.length - 4} more — so the check is not
  "did you ask for this" but "is this here at all". A candidate that will not stop is
  handled separately, by terminating the worker (AC-08).

  Stating which ones escape is the point. A harness claiming twelve of twelve would be
  claiming its lint is a sandbox, and the first person to try would find out it is not.
`);
