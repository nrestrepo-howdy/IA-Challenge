/**
 * Records the outcome of a verification run, independently of how it was invoked.
 *
 * The event log was blind to 95% of this project's own verifications, and the reason is
 * embarrassing and entirely mechanical: a shell pipeline exits with the status of its
 * *last* command, so `npm test 2>&1 | tail -5` reports success while the tests fail.
 * 127 verification invocations are in `.verbo/events.jsonl` and exactly 2 are marked as
 * failures — not because the suite was passing, but because the exit code was being
 * thrown away by the habit of trimming output to read it.
 *
 * The available fixes were "remember not to pipe" and "make the record not depend on
 * it". This project's own rule says which to pick: if you find yourself writing "the
 * agent should remember to…", make it impossible instead. So the outcome is written
 * here, by the verify chain itself, where no amount of piping downstream can hide it.
 *
 *   npm run verify   -> appends one line to .verbo/verify.jsonl
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const status = process.argv[2] === 'ok';

/** Read back from the gate's own output rather than re-counted here, so one number. */
function criteria() {
  try {
    const gate = readFileSync(join(ROOT, '.verbo/gate.txt'), 'utf8');
    const m = gate.match(/(\d+)\/(\d+) verified/);
    return m ? { verified: Number(m[1]), total: Number(m[2]) } : null;
  } catch {
    return null;
  }
}

mkdirSync(join(ROOT, '.verbo'), { recursive: true });
appendFileSync(
  join(ROOT, '.verbo/verify.jsonl'),
  JSON.stringify({
    ts: new Date().toISOString(),
    ok: status,
    criteria: criteria(),
    // The session, so a run can be tied back to the turn it happened in — which is what
    // makes an autonomous loop provable rather than asserted.
    session: process.env['CLAUDE_SESSION_ID'] ?? null,
  }) + '\n',
);
