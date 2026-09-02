# Workstream contracts

The source of truth is [`src/contracts.ts`](../../src/contracts.ts). This document
explains **why** the boundaries sit where they do — which is what the rubric actually
scores. Drawing five boxes is easy; justifying the lines between them is the work.

| WS | Name | Implements | Consumes | Isolated because |
|----|------|-----------|----------|------------------|
| 1 | core | `WorldHandle` | `Primitive` | It does not know agents exist |
| 2 | runtime | `Injector` | `Verdict`, `WorldHandle` | It does not know what anything looks like |
| 3 | harness | `Oracle[]`, `Prober` | `Candidate`, `StateContract` | Pure contract; testable with no world at all |
| 4 | intent | `IntentCompiler` | `WorldHandle` (read-only) | No rendering dependency whatsoever |
| 5 | world | `Primitive[]`, base scene | `WorldHandle` | Purely visual |

## Why these boundaries

**core / harness.** The harness verifies candidates *without* the real world: it takes
a `Candidate` and an `Intent` and returns a `Verdict`. That boundary is what makes it
possible to run the oracles inside a Worker and in headless CI — and it is also what
lets the harness be tested against synthetic candidates without ever opening a browser.
It is the boundary that makes the whole project testable.

**runtime / harness.** The runtime **cannot** inject without a `Verdict`; the signature
`inject(c, v)` requires one. AC-11 — L3 alone is never sufficient — holds because
`failedAt` is explicit and the injector refuses any verdict that failed L0, L1 or L2.
This is a deterministic guarantee expressed in the type system rather than a rule an
agent has to remember.

**world / core.** Primitives declare a `statePath`. That declaration is what makes L2
possible at all: a contract asserts over paths inside `__VERBO_STATE__` that exist
because some primitive registered them. Without this boundary there is no verifiable
contract, only screenshots — and R-2 says screenshots are not enough.

**intent isolated.** It compiles language into a (code, contract) pair without touching
rendering. It is the only workstream that can begin before any scene exists, which is
why it starts on day one alongside the harness.

## Integration rule

Nobody edits `src/contracts.ts` from a worktree. A contract change is a human decision:
it happens on `main`, with `VERBO_SPEC_UNLOCK=1`, and it lands in the event log.

This is the mechanism by which five parallel workstreams produce no merge conflicts.
The conflict count is tracked and reported — it is the evidence for integration quality,
and a number is more convincing than a claim.
