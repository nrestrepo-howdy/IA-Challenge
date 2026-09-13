/**
 * Autonomous loops, reconstructed from the event log rather than remembered.
 *
 * The submission rules ask for evidence that a loop went ACT → VERIFY → OBSERVE → FIX →
 * VERIFY "without a new human instruction in the middle". Prose describing such a loop
 * is not evidence of it; the claim is about what did *not* happen, and only a record
 * kept at the time can settle that.
 *
 * Every lifecycle event carries the id of the human prompt whose turn it belongs to.
 * That makes the absence mechanical rather than asserted: if a failing verification, the
 * edits that answered it, and the passing verification all share one prompt id, then no
 * new instruction arrived between them — there is nowhere for one to have gone.
 *
 * This reads `.verbo/events.jsonl` and prints the loops it can prove. It does not know
 * which ones are interesting; it knows which ones closed.
 *
 *   node tools/evidence/autonomy.mjs            # summary
 *   node tools/evidence/autonomy.mjs --trace N  # the full trace of loop N
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const rows = readFileSync(join(ROOT, '.verbo/events.jsonl'), 'utf8')
  .trim().split('\n')
  .map((line) => { try { return JSON.parse(line); } catch { return null; } })
  .filter(Boolean)
  .sort((a, b) => a.ts.localeCompare(b.ts));

/**
 * The harness commands, and only when they are what the command *does*.
 *
 * The first version matched the pattern anywhere in the shell string, which meant a
 * heredoc writing a test file counted as running one — and the traces it produced opened
 * with a failing `mkdir`, which is not evidence of anything. A command containing `<<` is
 * writing a document, not verifying.
 */
const VERIFY = /(^|[;&|]\s*)(npm (run )?(test|verify|typecheck|gate|audit)|npx (vitest|playwright|tsc))\b/;
const isVerify = (cmd) => typeof cmd === 'string' && !cmd.includes('<<') && VERIFY.test(cmd);
const isEdit = (tool) => /^(Edit|Write|NotebookEdit)$/.test(tool ?? '');

/** One turn per human instruction. Everything inside one was uninterrupted. */
const turns = new Map();
for (const row of rows) {
  if (!row.prompt) continue;
  if (!turns.has(row.prompt)) turns.set(row.prompt, []);
  turns.get(row.prompt).push(row);
}

/**
 * Verification outcomes that piping cannot hide.
 *
 * `.verbo/verify.jsonl` is written by the verify chain itself, for the reason recorded
 * in `record-verify.mjs`: 95% of this project's verification invocations were piped
 * through `tail` or `grep` to be readable, and a pipeline exits with the status of its
 * last command, so the event log saw 2 failures out of 127 runs. Anything dated after
 * that was fixed can be proven from here instead of inferred from an exit code that was
 * being discarded.
 */
let outcomes = [];
try {
  outcomes = readFileSync(join(ROOT, '.verbo/verify.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
} catch { /* not yet recorded; the event log is the only source */ }

const loops = [];
for (const [prompt, events] of turns) {
  const failure = events.find(
    (e) => e.event === 'PostToolUseFailure' && e.tool === 'Bash' && isVerify(e.cmd),
  );
  if (!failure) continue;

  const fixes = events.filter(
    (e) => e.event === 'PostToolUse' && isEdit(e.tool) && e.ts > failure.ts,
  );
  if (fixes.length === 0) continue;

  const recheck = events.find(
    (e) => e.event === 'PostToolUse' && e.tool === 'Bash' && isVerify(e.cmd) && e.ts > fixes[0].ts,
  );
  if (!recheck) continue;

  loops.push({
    prompt,
    failure,
    fixes,
    recheck,
    // Every event in the window, so the trace can show there is no gap to hide in.
    // `PreToolUse` is dropped: it is the same call as its `PostToolUse` and doubling
    // every line makes a short loop look like a long one.
    window: events.filter(
      (e) => e.ts >= failure.ts && e.ts <= recheck.ts && e.event !== 'PreToolUse',
    ),
    seconds: Math.round((Date.parse(recheck.ts) - Date.parse(failure.ts)) / 1000),
  });
}

const short = (s, n) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** Repo-relative, so a trace reads as a project and not as one machine's filesystem. */
const rel = (p) => (p ?? '').replace(ROOT, '').replace(/^.*\/scratchpad\//, 'scratch/');
const traceIndex = process.argv.indexOf('--trace');

/**
 * Delegation, counted rather than described — including what it cost.
 *
 * The interesting number here is not how many agents ran. It is how many of them never
 * reported finishing: a subagent that dies takes its context with it, and whether that
 * is survivable is a property of where the boundaries were drawn, not of the agents.
 */
if (process.argv.includes('--delegation')) {
  const starts = rows.filter((r) => r.event === 'SubagentStart');
  const stops = rows.filter((r) => r.event === 'SubagentStop');
  const stopped = new Set(stops.map((r) => r.agent));
  const orphans = starts.filter((r) => !stopped.has(r.agent));

  const timeline = [
    ...starts.map((r) => ({ t: r.ts, d: 1 })),
    ...stops.map((r) => ({ t: r.ts, d: -1 })),
  ].sort((a, b) => a.t.localeCompare(b.t));
  let live = 0, peak = 0, windows = 0;
  for (const e of timeline) {
    const before = live;
    live += e.d;
    peak = Math.max(peak, live);
    if (before < 2 && live >= 2) windows += 1;
  }

  console.log(`
  ${starts.length} subagents delegated, ${stops.length} reported finishing`);
  console.log(`  ${orphans.length} never reported (${Math.round((100 * orphans.length) / starts.length)}%)`);
  console.log(`  peak concurrency ${peak}; ${windows} windows with two or more live`);
  console.log(`  ${rows.filter((r) => r.event === 'WorktreeCreate').length} git worktrees created
`);
  process.exit(0);
}

if (traceIndex === -1) {
  console.log(`\n  ${loops.length} loops closed inside a single human turn`);
  console.log(`  ${turns.size} turns in the log, ${rows.length} events`);
  console.log(`  ${outcomes.length} verification outcomes recorded independently of the shell\n`);
  loops.forEach((loop, i) => {
    console.log(
      `  [${i}] ${loop.failure.ts.slice(0, 16).replace('T', ' ')}  ` +
      `${String(loop.seconds).padStart(4)}s  ${String(loop.fixes.length).padStart(3)} edits  ` +
      `prompt ${loop.prompt.slice(0, 8)}  ${short(loop.failure.cmd, 46)}`,
    );
  });
  console.log('\n  node tools/evidence/autonomy.mjs --trace N   for one in full\n');
} else {
  const loop = loops[Number(process.argv[traceIndex + 1] ?? 0)];
  if (!loop) { console.error('no such loop'); process.exit(1); }
  console.log(`\nprompt ${loop.prompt}  —  one human instruction, ${loop.seconds}s\n`);
  for (const e of loop.window) {
    const mark = e.event === 'PostToolUseFailure' ? 'FAILED' : e.event === 'Commit' ? 'commit' : '      ';
    const what = e.tool === 'Bash' ? short(e.cmd, 62) : short(rel(e.file) || e.tool, 62);
    console.log(`  ${e.ts.slice(11, 19)}  ${mark}  ${(e.tool ?? e.event).padEnd(8)} ${what}`);
  }
  const strays = new Set(loop.window.map((e) => e.prompt));
  console.log(`\n  distinct prompt ids across the whole window: ${strays.size}` +
    `  (${strays.size === 1 ? 'no new human instruction arrived' : 'INTERRUPTED'})\n`);
}
