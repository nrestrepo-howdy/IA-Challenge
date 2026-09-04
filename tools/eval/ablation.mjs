#!/usr/bin/env node
/**
 * Context ablation: what the written guidance is worth, measured.
 *
 * Two agents, same task (add a `lightning` primitive), same repository, same success
 * criterion (`npm run verify`). One was pointed at CLAUDE.md, the spec and the
 * contracts; the other was asked to infer the conventions from source alone.
 *
 * This is deliberately *not* an orchestration A/B. A real one would mean building the
 * project twice, which the time budget does not allow, and a comparison of two
 * different tasks measures nothing. Context is the variable that can be isolated
 * honestly: identical task, identical repo, one input removed.
 *
 *   node tools/eval/ablation.mjs <worktree-a> <worktree-b>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error('usage: ablation.mjs <worktree-a> <worktree-b>');
  process.exit(1);
}

const sh = (cwd, cmd, args) => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

/** Tool calls attributed to each agent, straight from the lifecycle event log. */
function toolCalls(agentId) {
  const log = join(ROOT, '.verbo/events.jsonl');
  if (!existsSync(log)) return null;
  let n = 0;
  for (const line of readFileSync(log, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (e.event === 'PreToolUse' && e.agent === agentId) n++;
    } catch { /* a truncated final line is not worth failing over */ }
  }
  return n;
}

function measure(dir, label) {
  const agentId = dir.split('agent-')[1]?.replace(/\/$/, '') ?? null;
  // `--porcelain` prefixes two status characters and a space, but an untracked
  // directory is reported as one entry, so the tree is expanded to real paths.
  // Slicing a fixed width mangled the first character of every path, which quietly
  // turned an in-scope file into an out-of-scope one.
  const status = sh(dir, 'git', ['status', '--porcelain', '-uall']).out
    .split('\n').filter(Boolean).map((l) => l.replace(/^.{2}\s+/, ''));
  const files = [...new Set(status)];

  // Files a scoped agent had no business touching. Not a moral judgement: it is the
  // measurable cost of conventions that were never written down.
  const IN_SCOPE = [/^src\/world\//, /^tests\//, /^src\/intent\/catalogue\.ts$/];
  const shared = files.filter((f) => !IN_SCOPE.some((re) => re.test(f)));

  const typecheck = sh(dir, 'npm', ['run', 'typecheck']);
  const unit = sh(dir, 'npm', ['test']);
  const gate = sh(dir, 'npm', ['run', 'gate']);
  const tests = /Tests\s+(\d+) passed/.exec(unit.out)?.[1] ?? '0';

  return {
    label,
    files: files.length,
    outsideScope: shared,
    toolCalls: agentId ? toolCalls(agentId) : null,
    typecheck: typecheck.ok,
    unit: unit.ok,
    unitCount: Number(tests),
    gate: gate.ok,
  };
}

const results = [measure(a, 'A · guided by the written context'), measure(b, 'B · source only')];

console.log('\nContext ablation — same task, same repo, one input removed\n');
console.log('  ' + 'run'.padEnd(34) + 'calls  files  typecheck  tests  gate  outside scope');
for (const r of results) {
  console.log(
    '  ' + r.label.padEnd(34)
    + String(r.toolCalls ?? '?').padEnd(7)
    + String(r.files).padEnd(7)
    + (r.typecheck ? 'pass' : 'FAIL').padEnd(11)
    + String(r.unitCount).padEnd(7)
    + (r.gate ? 'pass' : 'FAIL').padEnd(6)
    + (r.outsideScope.length ? r.outsideScope.join(', ') : 'none'),
  );
}
console.log('');
