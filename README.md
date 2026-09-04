# Verbo

**A 3D world you extend by speaking to it.** Ask for something — *"make it rain"* — and
a system of agents writes the code, verifies it in isolation, and hot-injects it into
the world you are already using. No reload. No black frame. No lost state.

The interesting part is not the generation. It is the **verification**: what it takes to
make it safe to inject machine-written code into a running system.

```bash
npm install && npm run dev     # then say "make it rain"
```

No API key required. The pipeline is provable end to end without one — see
[Why it runs offline](#why-it-runs-offline).

---

## How it works

Every candidate the agent writes runs inside a **Web Worker** — isolated, DOM-free,
killable — and must clear four short-circuiting oracles before it is allowed anywhere
near your world:

| Layer | Checks | Budget | Authoritative |
|-------|--------|--------|---------------|
| **L0** static | compiles, writes only in declared scope, no forbidden APIs | ~5 ms | yes |
| **L1** runtime | no crash, no black frame, ≤ 16 ms frames, budgets held | ~200 ms | yes |
| **L2** state contract | assertions over hidden runtime state, before/after snapshots | ~1 s | **yes — decides correctness** |
| **L3** perceptual | pixel delta plus a visual critic | ~5 s | **no — advisory only** |

**L2 decides correctness. L3 does not.** WorldCoder-Bench measured that external visual
scoring is uncorrelated with hidden-state correctness (Kendall τb = −0.02), and that an
agentic visual evaluator costing ~400× more still passes **45.6% of severely defective
outputs**. Putting a vision model at the centre of a correctness oracle means building
on a foundation already measured as insufficient — so Verbo inverts the ordering and
enforces it in the type system: `inject(candidate, verdict)` cannot be called with a
verdict that failed L0, L1 or L2, whatever L3 concluded.

Contracts are themselves verified. Each ships with deliberate sibling defects; a
contract that fails to catch its own mutants is discarded and regenerated.

### Why it runs offline

A closed catalogue of typed primitives (D-2) means the agent **composes rather than
invents**. Once a brief names primitives that exist and parameters that validated,
emitting the module is a templating problem, not a reasoning one — so the whole
pipeline is provable with no key and no network.

The language model earns its place **upstream**, resolving an utterance into a brief.
A model failure degrades to an explained rejection, never to broken code reaching the
world. Set `ANTHROPIC_API_KEY` to enable it; everything still works without it.

### A link carries intent, not code

A shared world is a URL holding the *utterances* that built it. Opening it replays them
through the same pipeline, so a shared world is **re-verified on arrival rather than
trusted** — and there is no way to hand someone a Verbo link that injects code into
their browser, because the link contains none. A replayed world is contract-identical,
not pixel-identical.

---

## Commands

```bash
npm run dev            # the world
npm test               # 181 unit tests — no browser, no key
npm run test:browser   # 14 acceptance tests in a real browser
npm run gate           # acceptance-criteria coverage against docs/SPEC.md
npm run verify         # all of the above; the definition of done
npm run eval           # one pass of the nightly evaluation corpus
npm run evidence       # regenerate the parallelism evidence in SYSTEM.md
```

`npm run verify` runs the browser suite deliberately. The gate counts browser criteria,
so a verification that skipped their tests would mark an acceptance criterion verified
by something it never executed — precisely the false green this project exists to
prevent. `npm run verify:fast` is the Node-only loop for iteration.

### Requirements

- Node 20+ (developed on 24)
- `jq` (used by the evidence hooks)
- A browser with WebGPU — Chrome, Edge, Firefox, or Safari 26+. Falls back to WebGL2
  automatically; append `?forceWebGL` to exercise that path on purpose.

### Environment

`cp .env.example .env`. Verbo is bring-your-own-key: nothing is bundled, and no key is
needed to read the code, run the world, or run any test.

| Variable | Required for |
|----------|--------------|
| `ANTHROPIC_API_KEY` | Model-backed utterance resolution only |

---

## The harness is also the development loop

The same four oracles serve both axes of the project, and that is deliberate rather
than economical:

- **At runtime** they gate what the agent may inject into the user's world.
- **During development** they gate every commit. There is no separate CI: the product's
  verification system *is* the project's verification system.

Two deterministic controls back it, enforced by exit code and verified working:

- **Protected artifacts.** `docs/SPEC.md`, `docs/contracts/`, `src/contracts.ts`,
  `.verbo/` and `.claude/hooks/` cannot be edited during implementation. An agent that
  can edit the specification can make any implementation correct. Escape hatch:
  `VERBO_SPEC_UNLOCK=1` — explicit, human, and logged.
- **Evidence capture.** Lifecycle events append to `.verbo/events.jsonl`. The
  parallelism evidence in `SYSTEM.md` is *generated* from it, never written from memory.

A nightly evaluation runs the real application through a browser over a corpus of
utterances and records what happened, failures included. It started on day three
because the useful number is the curve across nights, and elapsed time is the one input
that cannot be bought with effort.

---

## Repository layout

```
docs/
  SPEC.md              Objective, sourced constraints, decisions, 20 acceptance criteria
  SYSTEM.md            Agentic system map, with generated parallelism evidence
  AI-DEV-LOG.md        Iterations, failures, corrections, human decisions
  contracts/           Why the workstream boundaries sit where they do
src/
  contracts.ts         The five workstream interfaces — the only shared dependency
  core/                World registry: the state L2 asserts over
  harness/             L0-L3, the mutation hardener, the oracle cascade
  intent/              Utterance -> (code, contract), catalogue, model resolver
  runtime/             Candidate generation, probe worker, hot injection
  world/               Typed primitives
  render/              WebGPU, the base scene, state-to-visual bindings
  app/                 The cycle, sharing, the verification panel
tools/
  evidence/            Event-log readers, the acceptance gate
  eval/                Nightly evaluation
```

---

## Reading order for reviewers

1. **[docs/SPEC.md](docs/SPEC.md)** — what is built, and the sourced constraints that
   shaped it. Every R-n is a citation, not an assumption.
2. **[docs/SYSTEM.md](docs/SYSTEM.md)** — the agents, why each exists, what is
   deliberately *not* an agent, and the measured parallelism.
3. **[docs/AI-DEV-LOG.md](docs/AI-DEV-LOG.md)** — including the day-two finding that
   invalidated the original architecture, and every bug the harness caught in itself.
4. **[src/contracts.ts](src/contracts.ts)** — where the guarantees are types rather
   than rules.
