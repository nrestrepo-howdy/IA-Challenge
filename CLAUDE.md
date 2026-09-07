# Verbo — repository instructions

Read [docs/SPEC.md](docs/SPEC.md) before changing anything. It is the reference all
work is verified against, and it is protected by a hook.

## Non-negotiables

1. **Never edit `src/contracts.ts` from a worktree.** It is the frozen boundary between
   the five workstreams and the reason parallel work produces no merge conflicts. A
   contract change is a human decision made on `main`.
2. **Never edit `docs/SPEC.md`, `docs/contracts/`, `.verbo/` or `.claude/hooks/`.** A
   `PreToolUse` hook blocks it with exit code 2. If you believe the spec is wrong, say
   so and stop — do not work around it.
3. **Every acceptance criterion needs a test that names it.** Write `AC-nn` in the test
   description. `npm run gate` maps SPEC to tests and reports what nothing verifies.
4. **Stay inside your workstream.** Touch only your own directory under `src/`, plus
   `tests/` for what you wrote.
5. **Shared mutable state lives in its own module, never as an export from one
   workstream's file.** `src/app/injected-registry.ts` is the current example. If two
   workstreams need to agree on something, give it a name and a file — an export that
   one team created and another depends on looks like an accident to whoever reads it
   next, and will be removed by someone who cannot see why it exists.

## Verification

```bash
npm run typecheck     # strict; noUncheckedIndexedAccess is on
npm test              # vitest, no browser required
npm run gate          # acceptance-criteria coverage
npm run verify        # all three
```

`npm run verify` must pass before you report finished. If it does not, fix it and run
again — that loop is yours to close, not the reviewer's.

## Design rules specific to this codebase

- **L2 decides correctness; L3 does not.** The visual critic is advisory. `isInjectable()`
  in `src/harness/cascade.ts` is the single place that answers whether something may be
  injected. Do not restate that rule anywhere else.
- **Deterministic where a guarantee is needed, agentic where judgment is.** Oracles,
  the mutation engine, hooks and the gate are deterministic. If you find yourself
  writing "the agent should remember to…", make it impossible instead.
- **Diagnoses are actionable text, not scores.** A repair agent has to act on a verdict;
  a number cannot be acted on.
- **Every primitive implements `dispose()`.** Blob-URL modules can never be freed
  (SPEC R-4), so instance cleanup is the only lever there is.
- Prefer testing without a browser. The harness is designed so its correctness-deciding
  layers run in plain Node; keep it that way.

## Style

Match what is there. Comments explain *why*, and cite the constraint or decision id
(R-n, D-n, AC-n) when the reason lives in the spec. No comment that restates the code.
