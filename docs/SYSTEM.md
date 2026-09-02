# Verbo — Agentic System Map

> **Status** v1 · 2 Sep 2026 · Day 2 of 13.
> Sections marked ⏳ describe systems that are specified and contracted but not yet
> built. They will be filled from `.verbo/events.jsonl` — the event log — rather than
> written from memory. Nothing in this document is evidence until it is generated.

---

## 1. Two axes, one system

The rubric scores **the agentic system that builds the product**, not whether the
product happens to contain AI. Verbo lives on both axes, and the design decision that
matters is that they are **the same engineering artifact**:

- **Build axis** — agents build Verbo across 13 days, in five parallel worktrees.
- **Runtime axis** — Verbo itself is an agentic system that writes and verifies code.

The four-layer harness (§4) governs *both*. The same oracles that reject a candidate
in front of the user are the oracles that gate every commit during development. There
is no separate CI: the product's verification system is the project's verification
system.

This matters because of a line in the rules describing what does not score well:
*"a polished UI with no evidence of planning, testing, orchestration, or feedback
loops."* A beautiful 3D world is precisely what that sentence is aimed at. Sharing one
harness across both axes is the structural answer.

---

## 2. Agents and why each exists

The rules are explicit that agent count is not the goal, and that inventing roles to
satisfy the competition scores badly. Every agent below earns its separate context by
**specialization, isolation, or parallelism** — the three reasons the rules accept.

### Build-time

| Agent | Context boundary | Why separate |
|-------|------------------|--------------|
| **Researcher** | Read-only sweep; returns findings, not transcripts | Search burns enormous context and produces a small conclusion. Isolation keeps the main thread clean |
| **Planner** | Spec + findings → implementation plan | The human reviews *plans*, not code. A 200-line plan is reviewable; a 2,000-line diff is not |
| **Implementer ×5** | One worktree, one contract, one workstream | Genuine parallelism. Contracts (§3) are what make five simultaneous streams collision-free |
| **Reviewer** | Reads the integrated diff, never wrote it | An author cannot review their own work. Separation is the point |

### Runtime

| Agent | Context boundary | Why separate |
|-------|------------------|--------------|
| **Intent compiler** | Utterance + world state → `(code, contract)` | Produces the contract *before* seeing any candidate, so it cannot be written to fit the code |
| **Candidate generator ×3** | Intent + primitive library, ≤ 6 KB each | Three different strategies, in parallel. First valid one wins; latency is a product requirement (D-5) |
| **Visual critic (L3)** | One frame, one question | Deliberately narrow. It is a judge of taste, never of truth (§4) |
| **Repair agent** | Verdict diagnosis + failing candidate | Fresh context. The generator is anchored on its own broken attempt |

**Not agents, on purpose:** the mutation engine, the four oracles, the injector, the
hooks, the AC gate. These are guarantees, not judgments. The rules put it plainly —
*use agent reasoning where judgment is useful, deterministic controls where guarantees
are useful.* A rule an agent must remember is not a guarantee.

---

## 3. Parallel work

### Structure

Five workstreams, each in its own git worktree, each against a frozen TypeScript
interface in [`src/contracts.ts`](../src/contracts.ts). The contracts are written on
day 1–2 *before* any implementation — that is the entire reason the parallelism works.

| WS | Depends on | Can start |
|----|-----------|-----------|
| 3 harness | contracts only | Day 3 |
| 4 intent | contracts only | Day 3 |
| 1 core | contracts only | Day 3 |
| 5 world | WS1 `WorldHandle` | Day 5 |
| 2 runtime | WS1 + WS3 signatures | Day 5 |

### Integration

No worktree may edit `src/contracts.ts`; a deterministic hook blocks it. Contract
changes are human decisions made on `main` with an audited unlock. **Merge conflict
count is the integration metric** and is reported in §7 — the target is zero, and a
number is more persuasive than an assurance.

### Evidence ⏳

To be generated from the event log via `SubagentStart` / `SubagentStop` spans, which
carry `agent_id`, `agent_type` and wall-clock timestamps. That produces real
swimlanes with real elapsed time, not a drawing.

---

## 4. Harness

Four short-circuiting layers. Full definitions in [SPEC.md §4](SPEC.md).

| Layer | Checks | Budget | Deterministic |
|-------|--------|--------|---------------|
| L0 static | compiles, scope, forbidden APIs | ~5 ms | yes |
| L1 runtime | non-black, ≤16 ms frames, no crash, budgets | ~200 ms | yes |
| **L2 state contract** | assertions over `__VERBO_STATE__` | ~1 s | yes |
| L3 perceptual | pixel delta + visual critic | ~5 s | no |

### The inversion

**L2 decides correctness; L3 does not.** WorldCoder-Bench measured that external visual
scoring is uncorrelated with hidden-state correctness (τb = −0.02) and that an agentic
visual evaluator costing ~400× more still passes **45.6% of severely defective
outputs**.

The obvious build puts a vision model at the center because it is the impressive part.
That build rests on an oracle already measured as insufficient. Verbo demotes it and
promotes hidden-state contracts — and the type system enforces the ordering:
`inject(c, v)` cannot be called with a verdict whose `failedAt` is `L0`, `L1` or `L2`,
no matter what L3 said.

### Contracts are themselves verified

Each contract ships with sibling mutants — dropped state updates, corrupted constants,
swapped event targets, nulled disposers, the dominant real-world failure modes. A
contract that fails to catch its own mutants is discarded and regenerated (AC-10).

---

## 5. Deterministic controls

Implemented in `.claude/hooks/`, enforced by exit code 2. Verified working on day 2.

| Hook | Guarantee |
|------|-----------|
| `PreToolUse` on Edit/Write/Bash | `docs/SPEC.md`, `docs/contracts/`, `.verbo/`, `.claude/hooks/` cannot be modified during implementation. Escape hatch `VERBO_SPEC_UNLOCK=1` is explicit, human, and logged |
| 13 lifecycle events | Every tool call, subagent, task and worktree event appends to `.verbo/events.jsonl`. Evidence accrues whether or not anyone remembers to collect it |

The first control exists because the spec is the reference work is verified against.
An agent that can edit the specification can make any implementation correct.

---

## 6. Human decisions

Recorded as they happen, with dates. See [AI-DEV-LOG.md](AI-DEV-LOG.md) for the full
narrative.

| Date | Decision | Why it was not delegable |
|------|----------|--------------------------|
| 1 Sep | Six candidate concepts evaluated; five rejected | Taste and ambition. An agent optimizes a rubric; it does not decide what is worth building |
| 2 Sep | **L2 over L3** after reading WorldCoder-Bench | Choosing which oracle to trust is an architectural judgment with evidence behind it |
| 2 Sep | Closed primitive library instead of free generation | Accepting a measured 28% ceiling and engineering around it, rather than hoping |
| 2 Sep | Voice cut from v1 | Trading a feature for rubric coverage |
| 2 Sep | Contracts frozen before implementation | The precondition for parallelism |

⏳ Remaining, to be recorded as they occur: injection policy (what auto-injects vs.
what requires approval), the feature freeze call on 10 Sep, and the point at which the
system is judged trustworthy enough to demo live.

---

## 7. Metrics ⏳

Every number below will be generated, never estimated. Empty until the runs exist.

- Nightly evaluation: attempts, injection rate, rejections **per layer**, median time to injection.
- Contract quality: share of contracts that caught all sibling mutants on first generation.
- Parallelism: wall-clock overlap across worktrees, from `SubagentStart`/`SubagentStop`.
- Integration: merge conflicts across five workstreams.
- Memory: heap growth across 20 consecutive injections (R-4 is structural, so it is measured, not denied).

---

## 8. Autonomous loop evidence ⏳

Required shape: `ACT → VERIFY → OBSERVE → FIX → VERIFY`, with no human prompt in the
middle. Verbo's runtime loop is this by construction — generate, probe, fail a layer,
read the diagnosis, repair, re-probe — and a build-time instance will be captured as
well so there is no ambiguity about which axis the evidence comes from.

Extracted from the event log, not transcribed. **If the loop did not happen, the
extractor produces nothing.** That property is deliberate: the evidence cannot be
written by hand.
