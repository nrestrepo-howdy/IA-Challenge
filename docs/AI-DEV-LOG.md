# Verbo — AI Development Log

> Not a transcript. This records the iterations, failures, corrections and human
> decisions that actually shaped the product. Entries are written when they happen.
> Sections marked ⏳ do not exist yet and are not claimed to.

---

## 1 Sep — Six concepts, five rejected

The project did not start with Verbo. It started with five other ideas, and the
rejections are more instructive than the survivor.

| # | Concept | Why it died |
|---|---------|-------------|
| 1 | **Foreman** — spec fan-out to N worktrees, judge picks a winner | Sound engineering, but best-of-N over worktrees already has prior art. Nothing new |
| 2 | **Hydra** — self-healing CI that leaves behind a regression defense | Stripped of staging, it is "a bot that fixes broken tests." Worse, the sabotage premise is invented: nobody deletes guard clauses in production |
| 3 | **Polygraph** — detects when a coding agent's patch passes tests but is semantically wrong | Real problem, genuinely documented (~20% of leaderboard "solved" patches are semantically incorrect). But the output is a table of findings. Nobody *feels* a table |
| 4 | Verified migration with equivalence proofs | Direct prior art appeared in July 2026 (Locksmith Loop, COBOL→Java with a deterministic oracle) |
| 5 | Vericoding with machine-checked proofs (Dafny/Verus) | The highest "how did they do that" ceiling available, and unusable here: no way for a judge without formal-methods background to feel it in 90 seconds |
| 6 | **Verbo** | Survived |

**The pattern behind the first five.** All were developer tools *about the process of
building software*. Meta, every one. A developer admires them intellectually and feels
nothing. The rubric pulls hard in that direction — agentic engineering suggests tooling
— and following that pull produced five variations on a single idea.

**Human decision.** Reject the entire category. Require a project that is understood
in fifteen seconds without explanation *and* has real depth underneath. Only one
candidate satisfied both.

---

## 2 Sep — The correction that reshaped the architecture

**What was planned.** Three verification oracles, with a multimodal visual critic as
the centerpiece: the agent renders its work, *looks at it*, judges it against the
request, and iterates. It demos beautifully and reads as frontier work.

**What research found.** WorldCoder-Bench (arXiv 2606.01869; 2,026 curated Three.js
tasks) measures whether generated 3D worlds *work*, not whether they *look right*. Two
results:

1. External/DOM-based scoring is **uncorrelated** with hidden-state correctness —
   Kendall τb = −0.02 across 1,434 pairs.
2. An agentic visual evaluator costing **~400× more** still grants passing marks to
   **45.6% of severely defective outputs**.

**The consequence.** The centerpiece oracle approves roughly half of everything broken.
The plan was to build a harness the literature had already measured as insufficient —
and to present it as the project's strongest contribution.

**The correction.** Adopt StateProbe, the alternative the same paper proposes. A
runtime state interface (`window.__VERBO_STATE__`), scripted actions, before/after
snapshots, and machine-checkable behavioural contracts. `"make it rain"` no longer
compiles to code alone; it compiles to **code plus a contract**. The visual critic is
demoted to L3 — a judge of taste, never of truth — and the type system enforces it:
`inject(c, v)` refuses any verdict that failed L0–L2, regardless of what L3 concluded.

**Second-order effect.** The same benchmark reports the ceiling: the best model reaches
**27.8% Verification Coverage; no system exceeds 30%.** Roughly three in four attempts
at open-ended Three.js generation are behaviourally wrong. So the agent must not
generate freely — it composes and parameterizes a closed, typed primitive library.
Three parallel candidates and bounded retries stop being decoration and become the
engineering response to a *measured* 28% hit rate.

**Why this is logged.** Finding this on day 2 costs a rewrite of the architecture
section. Finding it on day 9 costs the project.

---

## 2 Sep — Five more constraints, from verification rather than assumption

Every load-bearing technical claim was checked before being built on. Two changed the
design; the rest set hard requirements.

- **Headless WebGPU never reaches the compositor on Windows/Linux.** Canvas capture
  simply does not work. Forces offscreen-texture rendering with
  `copyTextureToBuffer` + `mapAsync`. Not a design preference — the only path that works.
- **Blob-URL ES modules can never be freed.** The module namespace cache cannot be
  cleared. The leak is structural, so injections are budgeted per session and every
  primitive must implement `dispose()`. Denying it would have surfaced as a mystery
  crash mid-demo.
- **`WebGPURenderer` needs `await renderer.init()`** or the first frame is black —
  which is precisely what L1 detects, so the documented footgun became a test.
- **Web Worker + OffscreenCanvas** for candidate isolation: an infinite loop cannot be
  caught on the main thread, only killed. The worker is killable; `try/catch` is not.
- **Visual critic latency is 4–16 s.** Survivable only because L3 runs last, on
  candidates that already cleared three cheaper layers.

---

## 2 Sep — Evidence layer before product code

**Decision.** Build the event-capture layer before writing a line of the product.

**Reasoning.** Every other artifact can be reconstructed later. Development evidence
cannot: an hour of work that was not recorded is gone. `SYSTEM.md`, the parallelism
evidence and this log's later sections are all meant to be *generated* from
`.verbo/events.jsonl` rather than remembered.

**Verified, not assumed.** Both hooks were tested with synthetic payloads before being
trusted: the logger appended a well-formed record, and the guard returned exit code 2
on a write to `docs/SPEC.md`. A control that has not been observed working is a hope.

**Consequence worth noting.** The guard blocks the author too. Creating these documents
required `VERBO_SPEC_UNLOCK=1`, and that unlock is in the log. That is the intended
behaviour: the escape hatch is explicit, human, and audited.

---

## 2 Sep — First closed loop: the mutation engine mutated nothing

**Context.** The harness landed as three pure modules — L0 static analysis, L2 contract
evaluation, and the mutation hardener — deliberately chosen because they need no
browser and no GPU, which is what makes the oracle that decides correctness testable
in plain Node.

**The loop, with no human instruction between the steps:**

1. **Act.** Wrote the three modules and 27 tests bound to AC-04, AC-05, AC-09, AC-10.
2. **Verify.** `npm test` — 26 passed, 1 failed. `hardenContract` reported a sound
   contract as unsound.
3. **Observe.** The failing case was the `dropStateUpdate` mutant. `applyMutant` was
   implementing it as `node[leaf] = structuredClone(node[leaf])` — cloning the value
   in place. For a number, that is a no-op. The mutant changed nothing, so the
   `changesOverTime` assertion still passed, so the mutant "escaped".
4. **Fix.** A dropped state update is only meaningful *relative to the prior frame*:
   it means the value never moved off where it started. `applyMutant` needed the
   before-snapshot, which it did not receive. Signature changed to
   `applyMutant(before, after, mutant, path)`, and the mutation now rewinds the value
   to its pre-action state.
5. **Verify again.** 27/27, typecheck clean.

**Why this one is worth recording.** The bug was in the component whose entire job is
to prove the primary oracle is not a rubber stamp. A mutation engine that mutates
nothing reports every contract as sound — including contracts that assert nothing. It
would have silently disabled L2, the layer the whole architecture was reorganized
around on the same day, and the harness would have looked green while verifying
nothing at all.

It was caught in the first minute of the first test run because the hardener is tested
against a deliberately weak contract that it *must* reject. Testing the verifier
against known-bad input is the same principle the verifier applies to candidates,
turned on itself.

---

## 2 Sep — The instrumentation layer blocked the thing it was measuring

**What happened.** The first attempt to run the five workstreams in parallel failed
immediately. All three worktrees aborted with the same error: *"WorktreeCreate hook
succeeded but returned no worktree path."*

**Cause.** The evidence layer had been registered on thirteen lifecycle events,
`WorktreeCreate` among them. But that event is not merely observational: the harness
reads the hook's **stdout as the worktree path**. The logger writes to a file and
prints nothing, so the harness received an empty path and refused to create the
worktree. Every parallel workstream was blocked by the mechanism whose only purpose is
to record that they ran.

**Fix.** Remove the logger from that one event, in both project and user settings.
Worktree spans are reconstructed from `SubagentStart` / `SubagentStop`, which carry
`agent_id`, `agent_type` and timestamps — which is what the parallelism evidence
actually needs. `WorktreeCreate` added nothing that was not already available.

**Why it is worth a section.** It is a textbook observer effect: instrumentation that
does not merely watch the system but changes what it can do. Attaching a generic
handler to thirteen events looked like thoroughness; one of those events had
out-of-band semantics, and blanket instrumentation does not distinguish. The lesson
generalizes past this bug — a hook that can block is not a listener, and treating it
as one will eventually stop something that mattered.

It also failed in the most useful possible way: loudly, on first use, before any work
depended on it.

---

## 2 Sep — The scene was rendering; the test was reading an empty buffer

**The loop, with no human instruction between the steps:**

1. **Act.** Wrote the base scene, the WebGPU bootstrap and three browser-level tests
   for AC-01, AC-02 and AC-03.
2. **Verify.** `npm run test:browser` — 2 passed, 2 failed. Both failures were the
   same shape: zero non-black pixels in the readback.
3. **Observe.** The evidence contradicted the obvious diagnosis. AC-02 measured six
   hundred real frames, and `__VERBO_STATE__` was populated — so the renderer was
   demonstrably running. A scene that renders and reads back black is not a broken
   scene; it is a broken reading.
4. **Fix.** The test was drawing the canvas from *outside* the animation loop.
   Presentation does not survive the frame, and in headless it never reaches the
   compositor at all — which is R-3, already written into the spec on day two as a
   constraint on the shadow renderer. The same constraint applies to the app's own
   canvas, which the spec had not said out loud. Capture moved inside the loop,
   immediately after `render()`, and is exposed as `__VERBO__.capture()`.
5. **Verify again.** 4/4 passing. 18/20 acceptance criteria.

**Why it is worth recording.** The failure was a constraint the project had already
documented, arriving somewhere nobody had thought to apply it. R-3 was written as a
fact about the *shadow* renderer; it is a fact about WebGPU presentation, and the
scope was too narrow.

The fix is also load-bearing beyond this test: reading pixels from inside the loop is
exactly the mechanism the L3 perceptual oracle needs, so a bug in the acceptance suite
produced the seam the harness was going to need anyway.

Worth noting what stopped this becoming an hour of chasing the renderer: two other
signals disagreed with the failing one. A single red test invites you to fix the thing
it points at. Three signals that contradict each other tell you where to look.

---

## 2 Sep — Joining the five workstreams found two bugs neither typecheck nor unit tests could

The five workstreams had each passed their own verification in isolation. Wiring them
together against a real renderer surfaced two defects that only exist *between* them.

**1. A silent no-op.** `reconcile()` iterated the primitive registry with
`Object.values(primitives)`. WS5 returns a `ReadonlyMap`, and `Object.values()` on a
Map returns `[]` — so the loop ran zero times and no visual binding was ever created.
It typechecked, it built, and it rendered a base scene that would never have shown a
single injected primitive. Nothing failed; it simply did nothing.

It surfaced because a *different* consumer — the module loader — declared the type it
actually wanted, and the compiler objected. The bug was found by a type error in an
unrelated file.

**2. Double registration.** The cycle called `mount()` and then `register()`. But
`mount()` registers with the world itself, because a primitive cannot publish its
declared state slice until it has one. Every candidate threw *"instance
'rain-emitter#6' is already registered"*, so all three strategies failed, three
attempts deep, and the cycle reported a clean `all candidates failed`.

**What made this cheap.** The failure was legible without a debugger: the log said
which layer rejected, which strategy, and the verbatim error. A cycle that reported
only `ok: false` would have cost an hour. Diagnoses being actionable prose rather than
scores was a design rule written on day one for the repair agent's benefit; it paid
off first for a human.

**The observation worth keeping.** Both bugs are integration bugs, and both were
invisible to the thing that verified each workstream. Contracts prevented the
workstreams from *colliding*; they did not make their assumptions about each other
true. Freezing an interface buys parallelism, not agreement — and the end-to-end test
is what buys agreement.

---

## 2 Sep — 20/20

All twenty acceptance criteria have automated verification and it passes: 161 Node
tests and 8 browser tests. `npm run verify` runs both, because the gate counts browser
criteria and a verification that skipped their tests would mark an AC verified by
something it never executed.

The state of the world, honestly: the pipeline is real end to end — utterance,
compiled intent with a hardened contract, three genuinely different candidate
programs, L0/L1/L2 in cascade, hot injection into a live world — and it runs with no
API key and no network, because D-2 closed the generation surface so far that emitting
the module became a rendering problem rather than a reasoning one.

Still missing, and marked as missing: the L3 perceptual oracle, the model-backed
generator upstream of the brief, Worker isolation for candidate code in the browser
(proven in Node, interface unchanged), and the nightly evaluation.

## 2 Sep — Night one of the evaluation, and it disagreed with us immediately

The nightly evaluation drives the real application through a browser rather than
re-implementing the pipeline in Node, because an evaluation that exercises a parallel
copy of the system measures the copy.

**Night one: 14 of 15 utterances behaved as expected.** The disagreement is worth more
than the fourteen agreements.

`"make it rain money"` was **accepted**. The corpus expected a rejection. The keyword
resolver matched `rain`, mounted a rain emitter, satisfied its contract, and reported
success — while the salient word in the request, `money`, was never addressed and never
mentioned.

**This is not a bug in the matcher. It is a missing product decision.** There are two
defensible behaviours: reject, because the catalogue cannot express money; or accept
and *disclose* — "it will rain; I cannot make it money." What is not defensible is the
current one, which is to silently deliver a subset and call it done. That is the same
failure the rules name — *an agent that claims work is complete without meaningful
verification* — appearing in the intent layer rather than the harness.

**What was deliberately not done:** the corpus was not edited to match the behaviour.
Changing the expectation to fit the result is how an evaluation stops being one. The
disagreement stays red until the decision is made.

**Latency, honestly.** p50 is 3 ms and p95 is 26 ms against a 40 s budget (R-8). That
number is real but it is not yet meaningful: the deterministic generator does no
reasoning, so this measures template expansion. The budget exists for the model-backed
resolver upstream, and the figure to watch is the one after that lands. Publishing 3 ms
as though it were the answer would be the most flattering possible way to mislead.

---

## 3 Sep — Closing the night-one finding, and the model that earns its keep

**The decision.** "make it rain money" is accepted **and disclosed**, not rejected.
Refusing a request the world can partly satisfy is worse service than the alternative;
delivering the subset in silence is the failure the rules name by name. So the unmet
part travels with the intent, is stated to the user, and survives into the brief's
rationale and therefore into the world snapshot.

**Why the schema is where this lives.** Research on constrained generation is blunt
about the boundary: native structured output guarantees the *shape* of a response, not
its *meaning* — a schema cannot stop a model answering a different question. Two
consequences shaped the resolver:

- **Primitive names are an enum built from the catalogue**, so a name outside it is
  unrepresentable rather than rejected downstream. D-2 expressed where it cannot be
  forgotten, and derived from the catalogue so the two cannot drift.
- **`unaddressed` is a required field.** The one thing a schema *can* do about meaning
  is force the model to state what it did not do. A silent omission becomes a value
  the caller has to handle.

**The correction the evaluation forced.** First run after the change: 14/17. All three
disclosure cases came back *"accepted silently"*. The reason was real — only the
model-backed resolver emitted `unaddressed`, and the app runs the deterministic
resolver by default because it needs no API key.

That is not acceptable. A property that holds only on the paid path cannot be defended
by the offline test suite, and the offline path is what a judge runs. The keyword
resolver now computes the field too — less precisely than a model would, and honestly.
17/17.

**What was deliberately not done, twice.** The corpus was not edited to match the
behaviour on either night. On night one the expectation stayed red until the decision
was made; tonight the disclosure cases became their own category, `expectDisclosure`,
which requires acceptance **and** a non-empty disclosure. Counting them as plain
successes would let the system regress to silent partial fulfilment — the exact
failure the category exists to catch.

**On the resolver itself.** It is the only place a language model is used, and
everything downstream is deterministic: the brief becomes a module by template, the
oracles are code, the injection is code. A model failure degrades to an explained
rejection rather than to broken code reaching a live world. The system prompt and
catalogue are byte-identical across requests so the cached prefix survives; only the
utterance varies.

---

## 3 Sep — Closing the one place the code disagreed with the spec

D-9 said the candidate's code runs isolated and the pixels render on the main thread.
The browser cycle did neither half of that: it probed candidates on the main thread
against a scratch `World`. State was isolated; execution was not. A candidate with an
infinite loop would have wedged the page.

The gap was written into the module's own doc comment on the day it was introduced,
which is the only reason it did not quietly become permanent. A known deviation that is
documented is a task; an undocumented one is a surprise during a demo.

**Now:** candidates run in a Worker that builds its own `World` and its own primitive
registry. It cannot receive them from the page -- a Worker has a separate global, and a
structured clone of a live object graph would not be the same world anyway -- and
building them there is what makes the scratch world genuinely scratch.

**The negative property is the point.** `probe-worker.ts` contains no timeout logic. A
module that spins forever cannot be asked to stop, and a `try/catch` around an infinite
loop catches nothing. The timeout lives on the main thread, where `terminate()` exists,
and it destroys the thread.

The browser test proves it the same way the Node one does: a `setInterval` heartbeat on
the main thread keeps ticking straight through the spin, `2 + 2` is still 4 afterwards,
and `activeWorkers` returns to zero -- terminated, not merely abandoned. An abandoned
worker still burns a core, and a test that only checked the promise resolved would pass
on one.

---

## ⏳ Pending

Recorded here as absent so their absence is not mistaken for omission:

- **L3 perceptual oracle.** The capture seam exists; the critic does not.
- **Nightly evaluation results**, including failures and rejections per layer.
- **The injection policy decision** — what may auto-inject and what requires approval.
- **More failures during implementation.** The first is recorded above; there will
  be more, and they will be worth more than any of the successes.
