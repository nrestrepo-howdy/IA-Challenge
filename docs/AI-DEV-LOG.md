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

## ⏳ Pending

Recorded here as absent so their absence is not mistaken for omission:

- **Autonomous loop evidence.** Requires a running harness. Will be extracted from the
  event log; if the loop does not occur, the extractor yields nothing.
- **Nightly evaluation results**, including failures and rejections per layer.
- **The injection policy decision** — what may auto-inject and what requires approval.
- **Failures during implementation.** There will be some, and this section will be
  worth more than any of the successes above.
