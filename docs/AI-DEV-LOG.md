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

## ⏳ Pending

Recorded here as absent so their absence is not mistaken for omission:

- **L3 perceptual oracle.** The capture seam exists; the critic does not.
- **Worker isolation for candidate code in the browser.** Proven in Node (AC-08); the
  `Prober` interface is unchanged, so it drops in without touching the cycle.
- **Nightly evaluation results**, including failures and rejections per layer.
- **The injection policy decision** — what may auto-inject and what requires approval.
- **More failures during implementation.** The first is recorded above; there will
  be more, and they will be worth more than any of the successes.
