# Verbo

**A 3D world you extend by speaking to it.** Ask for something — *"make it rain"*,
*"make it day"*, *"raise a tower"* — and a system of agents writes the code, verifies it
in isolation, and hot-injects it into the world you are already using. No reload. No
black frame. No lost state.

Sixteen verbs today — weather, light and time of day, water, aurora, searchlights,
birds, falling bodies under gravity, and structural changes to the city itself — plus the path out of that list: ask
for *"un perro con una persona paseando"* and the agent writes a rig of shapes and the
code that walks it. Drag to look around, wheel to push in and out — the camera returns to its own shot after
a few seconds. Undo with ⌘Z, share a world as a link, and watch the verification race in
the panel while it happens.

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
| **L3** perceptual | pixel delta plus a visual critic, on a settled frame | ~5 s | **no — advisory only** |

**L2 decides correctness. L3 does not.** WorldCoder-Bench measured that external visual
the failures in generated 3D are dominated by **state-schema drift and broken
interaction chains rather than missing scene elements** — and missing scene elements are
exactly what a visual check is good at seeing. The benchmark's own protocol verifies
hidden runtime state with mutation-hardened contracts for that reason; so does this. Putting a vision model at the centre of a correctness oracle means building
on a foundation already measured as insufficient — so Verbo inverts the ordering and
enforces it in the type system: `inject(candidate, verdict)` cannot be called with a
verdict that failed L0, L1 or L2, whatever L3 concluded.

Contracts are themselves verified. Each ships with deliberate sibling defects; a
contract that fails to catch its own mutants is discarded and regenerated.

### When the catalogue cannot answer

A closed catalogue of weather and light meets *"un perro con una persona paseando"*
with "cannot express". That is honest, and it is also the product admitting it is a
lighting desk rather than a world — and it leaves the four oracles guarding code that
was never dangerous, because composing validated parameters cannot go wrong in an
interesting way.

So there is a second path. `verbo:figure` takes a rig of typed shapes and a function of
time, and the function is *written*, not chosen:

```js
import p0 from "verbo:figure";

export function mount(world) {
  return [{ instance: p0.mount(world, {
    name: "dog-walker",
    parts: [ /* 14 typed shapes, validated at the boundary */ ],
    pose: (t, p) => {
      const w = t * 3.4;
      p[0].y = 19.3 + Math.abs(Math.sin(w)) * 1.0;   // the walker's bob
      p[2].pitch = Math.sin(w) * 0.55;               // arms counter-swing
      p[4].pitch = -Math.sin(w) * 0.6;               // against the legs
      /* … */
    },
  }), statePath: "figures.dog-walker" }];
}
```

This is deliberately **not** the free-form Three.js synthesis D-2 rejects, and the
distinction is what makes it safe to run. A generated rig cannot import three, reach the
scene graph, build a material, or name a geometry outside four. What it writes is
arithmetic returning numbers. R-1 measures how often a model produces a behaviourally
correct *Three.js world*; `Math.sin(t * 4) * 0.6` for a leg swing is not that task.

What makes it safe is that it is verified like everything else — L0 lints the module, L1
runs it in a worker with its capabilities revoked, L2 asserts the rig actually *moves*
(a figure standing in a T-pose is the failure mode here), and L3 says whether it looks
like what was asked for. Every value a pose returns is clamped on the way into state, so
the worst a bad one can do is stand still in the wrong place.

Five rigs ship written by hand — a person, a dog, the two of them together, a car and a
tree — so the path works with no key at all and "un coche rojo cruzando la plaza"
resolves the red ground from the catalogue and the car from the library. With one, the
model writes the rig: `/api/figure` asks it for a part list and a `pose` body for
anything the catalogue left on the floor — which is why the author is consulted when a
request is *partly* met, not only when it misses entirely. "un coche rojo cruzando la
plaza" resolves the red ground from the catalogue and the car from the author, and if
the author is unreachable the request still returns the ground and discloses the car.

The catalogue stays closed underneath it: "make it rain" still resolves to rain and
nothing else, a rig cannot be reached by asking for weather, and a request neither a
primitive nor a rig can meet is still refused. That is **AC-22**, and the decision and
its cost are recorded as **D-10** in the SPEC rather than argued in a commit message.

The camera reframes for a rig, because a walking figure is forty units tall in a city of
three-hundred-unit towers and from the default viewpoint it is a detail. Someone who
says "un perro con una persona paseando" has named the subject of the picture.

### One assertion that is a law rather than a preference

Every other contract checks that the code did what it was told: rain falls at the speed
the catalogue named, a dawn takes the seconds it was given. `debris` can be checked
against physics instead. A semi-implicit integrator with restitution below one is
dissipative, so **total mechanical energy falls monotonically** — and a world that gains
energy every bounce does not look broken, it looks *livelier*, right up until the bodies
leave the frame.

That is the failure class WorldCoder-Bench reports as dominant — hidden state drifting
out of agreement with a scene that still looks plausible — and it is exactly what a
visual check cannot see. Switching the integrator to explicit Euler, the classic mistake,
renders beautifully and fails the test by name:

```
energy rose on 39 frames, worst by 13.34: expected 39 to be +0
```

### What the advisory layer is for

L3 cannot block an injection, and it is not decoration. On its first live frames it
found four defects nothing else could have: fog whose entire declared range rendered as
no fog, an aurora drawn seven degrees above the horizon and hidden behind the towers, a
storm rendered at midday, and a sea that could not be seen at any level because the
camera's frame began five degrees *above* the horizon. L0 parsed every one of those, L1
measured their frames, and L2 confirmed that every declared state field moved exactly as
its contract said. The contract says the world is correct; only a layer that looks can
say the world is wrong.

It judges a settled frame rather than the next one. Primitives arrive over time — a
cross-fade, an aurora brightening from zero — and the first version of this captured
thirty milliseconds after the mount and reported, accurately, on a world that no longer
existed a second later.

### The retry loop is a repair loop

Three candidates race per attempt, and up to three attempts run. Attempt N+1 is
informed by *why* N failed: the repair agent reads every rejected candidate's diagnosis
and returns two levers — adjusted parameters, and a different strategy order. It never
returns code. D-2 holds even here; there is no field in the repair schema for source.

Without a key the deterministic floor still adjusts parameters between attempts, so a
retry is never literally identical to the attempt it follows.

### Three ways it resolves what you say

| | How | When |
|---|---|---|
| **Server proxy** | `npm run dev` with `ANTHROPIC_API_KEY` set. The key stays in the Node process; the browser calls same-origin endpoints | Local development — the right shape |
| **Your own key** | Paste it into the field bottom-right of the hosted site. It lives in `sessionStorage` for that tab and goes straight from your browser to Anthropic | The published URL, which is static and has no server |
| **Phrasebook** | Nothing to configure | Always available, and what runs with neither of the above |

The browser path is a real trade and the UI says so rather than burying it: a key in a
browser is readable by anything else running in that browser. It exists because the
published site is static, and a public link that could only ever demonstrate keyword
matching would be demonstrating the wrong thing. The credential is yours, never ours,
and closing the tab ends the arrangement.

All three feed the **same** resolver, contracts and oracles. A hosted visitor and a
local developer run identical verification; only the quality of the language
understanding differs.

### Why it runs offline at all

A closed catalogue of typed primitives (D-2) means the agent **composes rather than
invents**. Once a brief names primitives that exist and parameters that validated,
emitting the module is a templating problem, not a reasoning one — so the whole
pipeline is provable with no key and no network.

The language model earns its place **upstream**, resolving an utterance into a brief.
A model failure degrades to an explained rejection, never to broken code reaching the
world. Set `ANTHROPIC_API_KEY` to enable it; everything still works without it.

Resolution is two calls, and the reason is worth stating because it is not obvious.
Naming a primitive's parameters in the output grammar is the only thing that makes a
model fill them: against an open `record` it composes correctly and returns `{}` for
every parameter, at any effort, under any instruction — a field with no name has no box
to fill. But a grammar naming all fifteen primitives' parameters at once is refused as
too large, because constrained decoding admits an object's keys in any order and k keys
cost k! paths. So the call splits where the reasoning already divides: one call chooses
what to compose, one sets the numbers for the three or four it chose, reading the
first's interpretation rather than re-deriving it.

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
npm test               # 439 unit tests — no browser, no key
npm run test:browser   # 26 acceptance tests in a real browser
npm run gate           # acceptance-criteria coverage against docs/SPEC.md
npm run verify         # all of the above; the definition of done
npm run eval           # one pass of the nightly evaluation corpus
npm run evidence       # regenerate the parallelism evidence in SYSTEM.md
npm run evidence:autonomy   # reconstruct autonomous loops from the event log
npm run evidence:loop       # run the product's own repair loop and print the trace
npm run attack              # run the attack corpus against L0 and report what escapes
```

`npm run verify` runs the browser suite deliberately. The gate counts browser criteria,
so a verification that skipped their tests would mark an acceptance criterion verified
by something it never executed — precisely the false green this project exists to
prevent. `npm run verify:fast` is the Node-only loop for iteration.

### The evidence is in the repository

`.verbo/events.jsonl` (3,956 lifecycle events across twelve days) and `.verbo/eval/` (ten
nights) are committed, because every evidence tool above reads them and evidence that
lives only on the machine that produced it is a claim with a script attached.

Secrets are stripped **at write time** by `.claude/hooks/log-event.sh`, not before
publishing: the log records every command, and a command is exactly where a key ends up.
Fifty-eight lines held one before that existed.

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
| `ANTHROPIC_API_KEY` | Model-backed utterance resolution, the rig author, the L3 visual critic, and model-backed repair. Each has a deterministic fallback; none is required |

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
.claude/
  agents/              The five workstream agents, with their tool boundaries
  skills/              Procedures that used to be instructions
  hooks/               Deterministic controls: protected artifacts, evidence capture
docs/
  SPEC.md              Objective, sourced constraints, decisions, 22 acceptance criteria
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
