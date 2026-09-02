# Verbo

**A 3D world you extend by speaking to it.** Ask for something — *"make it rain"* — and
a system of agents writes the code, verifies it in isolation, and hot-injects it into
the world you are already using. No reload. No black frame. No lost state.

The interesting part is not the generation. It is the **verification**: what it takes
to make it safe to inject machine-written code into a running system.

> **Status: day 2 of 13.** Specification, workstream contracts and the evidence layer
> are in place and verified. Product implementation begins day 3. This README describes
> what exists today; commands that are not yet runnable are marked ⏳.

---

## How it works

Every candidate the agent writes runs inside a **Web Worker with an `OffscreenCanvas`**
— isolated, DOM-free, killable — and must clear four short-circuiting oracles before it
is allowed anywhere near your world:

| Layer | Checks | Budget |
|-------|--------|--------|
| **L0** static | compiles, writes only in declared scope, no forbidden APIs | ~5 ms |
| **L1** runtime | no black frame, ≤ 16 ms frames, no crash, budgets held | ~200 ms |
| **L2** state contract | assertions over hidden runtime state, with before/after snapshots | ~1 s |
| **L3** perceptual | pixel delta plus a visual critic | ~5 s |

**L2 decides correctness. L3 does not.** WorldCoder-Bench measured that external visual
scoring is uncorrelated with hidden-state correctness (τb = −0.02), and that an agentic
visual evaluator costing ~400× more still passes **45.6% of severely defective
outputs**. Putting a vision model at the center of a correctness oracle means building
on a foundation that has already been measured as insufficient — so Verbo inverts the
ordering, and enforces it in the type system: `inject(candidate, verdict)` cannot be
called with a verdict that failed L0, L1 or L2, whatever L3 concluded.

Contracts are themselves verified. Each ships with deliberate sibling defects; a
contract that fails to catch its own mutants is discarded and regenerated.

---

## Repository layout

```
docs/
  SPEC.md              Objective, constraints, architecture, decisions, 20 acceptance criteria
  SYSTEM.md            Agentic system map: agents, contexts, orchestration, controls
  AI-DEV-LOG.md        Iterations, failures, corrections, human decisions
  contracts/           Why the workstream boundaries sit where they do
src/
  contracts.ts         The five workstream interfaces — the only shared dependency
  core/                WS1 · render core (WebGPU, Three r182)
  runtime/             WS2 · candidate generation and hot injection
  harness/             WS3 · shadow prober and the four oracles
  intent/              WS4 · utterance → (code, contract)
  world/               WS5 · base scene and typed primitives
tools/evidence/        Event-log readers and report generators
.claude/hooks/         Evidence capture and deterministic controls
```

---

## The harness as a feedback loop

The same four oracles serve both axes of the project, and that is deliberate rather
than economical:

- **At runtime** they gate what the agent may inject into the user's world.
- **During development** they gate every commit. The base scene is built by agents that
  render, inspect the result, observe that they broke something, and fix it — without a
  new instruction between those steps.

There is no separate CI. The product's verification system *is* the project's
verification system, which is why a beautiful 3D world does not end up as
*"a polished UI with no evidence of planning, testing, orchestration, or feedback
loops."*

## Deterministic controls

Two hooks, enforced by exit code, verified working:

- **Protected artifacts.** `docs/SPEC.md`, `docs/contracts/`, `.verbo/` and
  `.claude/hooks/` cannot be edited during implementation. The specification is the
  reference work is verified against; an agent that can edit it can make any
  implementation correct. Escape hatch: `VERBO_SPEC_UNLOCK=1` — explicit, human, logged.
- **Evidence capture.** Thirteen lifecycle events append to `.verbo/events.jsonl`.
  `SYSTEM.md` and the parallelism evidence are generated from it rather than written
  from memory.

---

## Running it

### Requirements

- Node 20+ (developed on 24)
- `jq` (used by the hook scripts)
- A browser with WebGPU — Chrome, Edge, Firefox or Safari 26+. Falls back to WebGL2
  automatically.

### Environment

Copy `.env.example` to `.env`. Verbo is **bring-your-own-key**: no key is bundled, and
none is required to read the code or run the harness tests.

| Variable | Required for | Notes |
|----------|--------------|-------|
| `ANTHROPIC_API_KEY` | Candidate generation and the L3 visual critic | Not needed for L0–L2 |

### Commands ⏳

```bash
npm install
npm run dev             # the world
npm test                # harness unit tests — no browser, no key needed
npm run verify          # all 20 acceptance criteria
npm run eval            # nightly evaluation batch
npm run evidence        # regenerate SYSTEM.md sections from the event log
```

---

## Reading order for reviewers

1. **[docs/SPEC.md](docs/SPEC.md)** — what is being built, and the sourced constraints
   that shaped it.
2. **[docs/SYSTEM.md](docs/SYSTEM.md)** — the agents, why each one exists, and what is
   deliberately *not* an agent.
3. **[docs/AI-DEV-LOG.md](docs/AI-DEV-LOG.md)** — including the day-2 finding that
   invalidated the original architecture.
4. **[src/contracts.ts](src/contracts.ts)** — where the guarantees are expressed as types.
