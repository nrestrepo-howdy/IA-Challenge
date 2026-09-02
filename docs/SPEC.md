# Verbo — Engineering Specification

> **Status** v1 · 2 Sep 2026 · **Author** human (not delegated)
> This document is the reference every piece of work is verified against.
> It is protected by a deterministic control (`.claude/hooks/guard-protected.sh`).
> Editing it requires `VERBO_SPEC_UNLOCK=1` and is recorded in the event log.

---

## 1. Objective

Verbo is a 3D world in the browser that the user **extends by speaking to it**. When
the user asks for a new capability — *"make it rain"* — a system of agents writes the
code, verifies it in isolation, and **hot-injects it into the world the user is
currently using**: no reload, no black frame, no lost state.

The engineering thesis is not generation. It is **verification**: what it actually
takes to make it safe to inject machine-written code into a running system.

## 2. Non-goals

Stated explicitly, to protect scope.

- **Not** a world generator. Verbo starts from an authored base scene.
- **Not** an asset or geometry generator. It composes typed primitives that exist.
- **Not** a pursuit of maximum autonomy. It pursues **verifiable** autonomy.
- **No** voice input in v1 (traded for rubric coverage; see D-8).
- **No** multi-user backend. Persistence is world serialization to a shareable link.

## 3. Constraints

### 3.1 Verified against literature and vendor documentation

These are not assumptions. Each is sourced, and each one forced a design decision.

| ID | Constraint | Source |
|----|------------|--------|
| **R-1** | State of the art produces *behaviorally correct* Three.js worlds roughly **28% of the time** (best model 27.8% Verification Coverage; no system exceeds 30%) | WorldCoder-Bench (arXiv 2606.01869) |
| **R-2** | External visual scoring is **uncorrelated** with hidden-state correctness (Kendall τb = −0.02 over 1,434 pairs). An agentic visual evaluator costing ~400× more still **passes 45.6% of severely defective outputs** | WorldCoder-Bench |
| **R-3** | In headless environments, WebGPU canvas presentation **never reaches the compositor** on Windows/Linux. Deterministic capture requires rendering to an offscreen texture and reading back via `copyTextureToBuffer` + `mapAsync` | WebGPU headless behaviour |
| **R-4** | ES modules imported via blob URL **can never be released**: there is no way to clear the module namespace cache. The leak is structural, not a bug | ES module semantics |
| **R-5** | `WebGPURenderer` requires `await renderer.init()`; skipping it ships a black first frame | Three.js r182 |
| **R-6** | `timestamp-query` values are quantized to 100 µs by default | WebGPU |
| **R-7** | Multimodal visual critic latency runs 4–16 s depending on model | 2026 vision-model benchmarks |
| **R-11** | WebGPU is available in workers (`WorkerNavigator.gpu`) and multiple devices per page are explicitly supported — but Three.js has known friction with `WebGPURenderer` inside `OffscreenCanvas` (a regression in r179, and it expects `canvas.style` which `OffscreenCanvas` lacks) | WebGPU explainer; three.js #31605 |

### 3.2 Product constraints

| ID | Constraint |
|----|------------|
| **R-8** | End-to-end budget: **≤ 40 s** from utterance to injection (p50) |
| **R-9** | The user's world must **never** lose state, render black, or drop below 30 fps because of an injection |
| **R-10** | A judge must run it on their own machine with one command and their own key (BYOK) |

---

## 4. Architecture

### 4.1 Four verification layers

Every candidate runs inside a **Web Worker with an `OffscreenCanvas`** — isolated, no
DOM access, killable by timeout — and passes through four short-circuiting oracles:

| Layer | What it checks | Budget | Nature |
|-------|----------------|--------|--------|
| **L0 static** | Compiles (TSL→WGSL), writes only inside its declared scope, uses no forbidden APIs | ~5 ms | Deterministic |
| **L1 runtime** | `init()` resolved, no exception across 120 frames, frame time ≤ 16 ms, draw-call and memory budgets held | ~200 ms | Deterministic |
| **L2 state contract** | Assertions over `window.__VERBO_STATE__` with before/after snapshots around scripted actions | ~1 s | **Primary oracle** |
| **L3 perceptual** | Pixel diff (did anything change at all) plus a multimodal visual critic | ~5 s | **Judge of taste, not of truth** |

### 4.2 The central decision

**L2 decides correctness. L3 does not.**

R-2 measures that external visual evaluation passes nearly half of severely defective
output. Any system that puts a vision model at the center of its correctness oracle is
built on a foundation the literature has already measured as insufficient. Verbo
inverts the obvious ordering: hidden-state contracts are authoritative, and the
vision model is demoted to breaking ties on aesthetics.

This inversion is the single most important engineering decision in the project.

### 4.3 Contracts hardened by mutation

A state contract is not accepted on faith. Deliberate defects are injected into the
candidate — drop a state update, corrupt a constant, swap an event target, null out a
disposer — and **if the contract fails to catch them, the contract is worthless and is
regenerated.** A verifier that cannot detect known-bad input is not a verifier.

### 4.4 Primitive library

Because of R-1, the agent **does not invent**. It composes and parameterizes typed
world primitives — emitters, materials, force fields, lights, modulators — each with a
mandatory `dispose()` (R-4) and a declared slice of `__VERBO_STATE__`.

This collapses the task from open-ended Three.js synthesis, where the state of the art
succeeds 28% of the time, down to constrained composition over a known API surface.

---

## 5. Major technical decisions

| # | Decision | Rejected alternative | Rationale |
|---|----------|---------------------|-----------|
| **D-1** | State contract as the primary oracle | Visual critic as primary oracle | R-2: it passes 45.6% of broken output |
| **D-2** | Composable typed primitive library | Free-form Three.js generation | R-1: a 28% hit rate is unusable live |
| **D-3** | Worker + OffscreenCanvas per candidate | `try/catch` on the main thread | An infinite loop cannot be caught — only killed |
| **D-4** | Offscreen texture render + readback | Canvas screenshot | R-3: the only deterministic cross-platform path |
| **D-5** | 3 parallel candidates, first valid wins | One candidate with serial retries | R-8: latency is a product requirement, so parallelism buys something real |
| **D-6** | Bounded injection budget per session | Unlimited injections | R-4: the leak is structural, so it is bounded rather than pretended away |
| **D-7** | TSL rather than hand-written WGSL/GLSL | Native shader code | One source compiles to both; WebGL2 fallback comes free |
| **D-8** | No voice in v1 | Voice as the differentiator | 12 h buys more as rubric coverage than as garnish |
| **D-9** | Split the shadow: the **candidate's code** runs in a Worker, the **shadow render** runs on the main thread in a second offscreen context | Full `WebGPURenderer` inside the Worker | R-11. Isolation is needed for *code* — an infinite loop must be killable — not for pixels. Rendering where Three.js is supported avoids a known-broken path, and a device may drive any number of canvases, so a second context costs nothing. The `Prober` interface is unchanged, which is why this could be decided after it was built |

---

## 6. Acceptance criteria

Every AC is machine-verifiable. **An AC without a passing verification fails the build.**

### Render core
- **AC-01** The base scene loads with `await renderer.init()` resolved and a non-black first frame.
- **AC-02** The base scene holds ≥ 55 median fps for 10 s on reference hardware.
- **AC-03** With WebGPU disabled, it falls back to WebGL2 and AC-01 still holds.

### Harness
- **AC-04** L0 rejects a module that fails to compile, in < 50 ms.
- **AC-05** L0 rejects a module that writes outside its declared scope.
- **AC-06** L1 rejects a module whose median frame time exceeds 16 ms.
- **AC-07** L1 rejects a module that produces an all-black frame.
- **AC-08** L1 kills an infinite-loop candidate by timeout without affecting the main thread.
- **AC-09** L2 rejects a candidate that does not satisfy its state contract.
- **AC-10** A contract that fails to catch its three sibling mutants is discarded and regenerated.
- **AC-11** L3 can never approve on its own: a candidate failing L2 is not injected even if L3 approves it.

### Runtime and injection
- **AC-12** After an injection, prior user state (camera, inputs, created objects) is identical.
- **AC-13** An injection that throws within the first 3 s rolls back automatically and the world is restored.
- **AC-14** The world never renders a black frame during an injection.
- **AC-15** After 20 consecutive injections, memory stays within the declared budget.

### Intent
- **AC-16** Every intent produces a (code, contract) pair — never code without a contract.
- **AC-17** An impossible intent produces an explained rejection, not a silent attempt.

### End to end
- **AC-18** "Make it rain" completes the full cycle in ≤ 40 s at p50.
- **AC-19** With all three candidates failing, the system retries ≤ 3 times then reports; it never hangs.
- **AC-20** A world serializes to a link and restores with the same verbs applied.

---

## 7. Definition of done

1. All 20 acceptance criteria have automated verification, and it passes.
2. The harness governs development: no commit lands without passing through it.
3. The nightly evaluation has accumulated ≥ 5 nights and publishes success **and failure** rates.
4. A third party clones the repo, runs one command, and sees the world using their own key.
5. `SYSTEM.md` and `AI-DEV-LOG.md` are generated from the event log rather than written from memory.
