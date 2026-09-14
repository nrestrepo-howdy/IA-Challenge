# Verbo — Engineering Log

> A curated record of the decisions, failures and corrections that shaped this system —
> not a transcript. Entries were written as the work happened. Items marked ⏳ do not
> exist and are not claimed to.
>
> The findings below are the ones worth a reviewer's time. Each links to its entry.

## Key findings

| # | Finding | Consequence |
|---|---------|-------------|
| 1 | [Research invalidated the planned architecture on day two](#f1) | The centrepiece oracle was measured as insufficient before it was built. Rewritten around hidden-state contracts |
| 2 | [The mutation engine mutated nothing](#f2) | The component that proves L2 is not a rubber stamp was itself a no-op. Caught on its first run |
| 3 | [The capability check was a spell-checker](#f3) | Twelve hostile modules, twelve passes. The boundary moved from detection to removal |
| 4 | [Telemetry was blind to 95% of its own verifications](#f4) | 121 of 127 verification runs were piped through `tail`, discarding the exit code |
| 5 | [A citation did not support the claim built on it](#f5) | The project's most load-bearing constraint cited numbers that were not in the paper |
| 6 | [The perceptual critic was judging the wrong frame](#f6) | L3 reported "no human figure" about frames containing one, on every figure request ever run |

---

## 1 Sep — Concept selection: five rejected, one kept

The project began with six candidates. The rejections are more instructive than the
survivor.

| # | Concept | Why it was rejected |
|---|---------|---------------------|
| 1 | **Foreman** — spec fan-out to N worktrees, judge picks a winner | Sound, but best-of-N over worktrees has prior art |
| 2 | **Hydra** — self-healing CI leaving a regression defence | Stripped of staging it is "a bot that fixes broken tests", and the sabotage premise is invented |
| 3 | **Polygraph** — detects patches that pass tests but are semantically wrong | Real problem (~20% of leaderboard "solved" patches are semantically incorrect). Output is a table of findings; nobody *feels* a table |
| 4 | Verified migration with equivalence proofs | Direct prior art published July 2026 |
| 5 | Vericoding with machine-checked proofs (Dafny/Verus) | Highest technical ceiling available, and unusable: no reviewer without formal-methods background can feel it in 90 seconds |
| 6 | **Verbo** | Kept |

**The pattern.** All five rejects were developer tools *about the process of building
software*. A developer admires them and feels nothing. The brief pulls in that direction,
and following the pull produced five variations on one idea.

**Decision.** Reject the category. Require a project understood in fifteen seconds
without explanation *and* with real depth underneath. One candidate satisfied both.

---

<a id="f1"></a>

## 2 Sep — Research invalidated the planned architecture

**Planned.** Three verification oracles with a multimodal visual critic as the
centrepiece: the agent renders its work, looks at it, judges it against the request, and
iterates. It demonstrates well and reads as frontier work.

**Found.** WorldCoder-Bench (arXiv 2606.01869; 2,026 curated Three.js tasks) measures
whether generated 3D worlds *work*. Its reported failures are **dominated by
state-schema drift and broken interaction chains rather than missing scene elements.**

That is a sharper argument against a visual centrepiece than unreliability would be.
Missing scene elements are precisely what looking is good at, and the measurement says
that is not the common failure. The common failure is state that has drifted out of
agreement with what the controls believe — invisible to a critic by construction. A world
can look exactly like rain while its hidden state says nothing is falling.

**Correction.** Adopt StateProbe, the protocol the same paper proposes: a runtime state
interface (`__VERBO_STATE__`), scripted actions, before/after snapshots, and
machine-checkable behavioural contracts hardened against mutation. An utterance no longer
compiles to code; it compiles to **code plus a contract**. The visual critic is demoted to
L3 — a judge of taste, never of truth — and the type system enforces it: `inject(c, v)`
will not accept a verdict that failed L0–L2, whatever L3 concluded.

**Second-order effect.** The same benchmark reports the ceiling: **27.8% verification
coverage on WorldCoder-Core, 19.9% on WorldCoder-Robust; no system exceeds 30%.** Roughly
three in four attempts at open-ended Three.js generation are behaviourally wrong. So the
agent does not generate freely — it composes and parameterises a closed, typed primitive
library. Three parallel candidates and bounded retries stop being decoration and become
the engineering response to a measured hit rate.

**Why this is logged.** Finding it on day 2 costs an architecture rewrite. Finding it on
day 9 costs the project.

### Five further constraints, verified rather than assumed

- **Headless WebGPU never reaches the compositor on Windows/Linux.** Canvas capture does
  not work; forces offscreen rendering with `copyTextureToBuffer` + `mapAsync`.
- **Blob-URL ES modules can never be freed.** The module namespace cache cannot be
  cleared, so the leak is structural: injections are budgeted per session and every
  primitive implements `dispose()`.
- **`WebGPURenderer` requires `await renderer.init()`** or the first frame is black —
  which is what L1 detects, so a documented footgun became a test.
- **Worker + OffscreenCanvas for candidate isolation.** An infinite loop cannot be caught
  on the main thread, only killed. A worker is killable; `try/catch` is not.
- **Visual critic latency is 4–16 s.** Survivable only because L3 runs last, on candidates
  that already cleared three cheaper layers.

---

## 2 Sep — Evidence layer before product code

**Decision.** Build event capture before writing any product code. Every other artifact
can be reconstructed later; development evidence cannot. An hour of work that was not
recorded is gone.

Both hooks were tested with synthetic payloads before being trusted: the logger appended
a well-formed record, and the guard returned exit code 2 on a write to `docs/SPEC.md`. A
control that has not been observed working is a hope. The guard blocks the author too —
creating the protected documents requires `VERBO_SPEC_UNLOCK=1`, and every unlock is in
the log.

### The instrumentation blocked what it was measuring

The first parallel run failed immediately: all three worktrees aborted with *"WorktreeCreate
hook succeeded but returned no worktree path."*

The logger had been registered on thirteen lifecycle events. One of them is not
observational — the harness reads that hook's **stdout as the worktree path**. The logger
writes to a file and prints nothing, so every parallel workstream was blocked by the
mechanism whose only purpose was to record that they ran.

Worktree spans are reconstructed from `SubagentStart`/`SubagentStop` instead, which carry
everything the parallelism evidence needs. A textbook observer effect: blanket
instrumentation does not distinguish events with out-of-band semantics, and **a hook that
can block is not a listener.** It failed in the most useful way available — loudly, on
first use, before anything depended on it.

---

<a id="f2"></a>

## 2 Sep — The mutation engine mutated nothing

The harness landed as three pure modules — L0 static analysis, L2 contract evaluation,
and the mutation hardener — deliberately chosen because they need no browser and no GPU,
which is what makes the oracle that decides correctness testable in plain Node.

**The loop, with no human instruction between the steps:**

1. **Act.** Three modules, 27 tests bound to AC-04, AC-05, AC-09, AC-10.
2. **Verify.** 26 passed, 1 failed: `hardenContract` reported a sound contract as unsound.
3. **Observe.** The failing case was the `dropStateUpdate` mutant. `applyMutant` implemented
   it as `node[leaf] = structuredClone(node[leaf])` — cloning the value in place, which for
   a number is a no-op. The mutant changed nothing, so the assertion still passed, so the
   mutant "escaped".
4. **Fix.** A dropped state update is only meaningful *relative to the prior frame*: the
   value never moved off where it started. The signature became
   `applyMutant(before, after, mutant, path)`, rewinding the value to its pre-action state.
5. **Verify.** 27/27, typecheck clean.

**Why it matters.** The bug was in the component whose entire job is to prove the primary
oracle is not a rubber stamp. A mutation engine that mutates nothing reports every
contract as sound — including contracts that assert nothing. It would have silently
disabled L2, the layer the architecture had been reorganised around that same day, and the
harness would have looked green while verifying nothing.

It was caught in the first minute of the first test run because the hardener is tested
against a deliberately weak contract it *must* reject. Testing the verifier against
known-bad input is the principle the verifier applies to candidates, turned on itself.

---

### A second closed loop: the scene was rendering and the test was reading an empty buffer

Again with no human instruction between the steps — `npm run evidence:loop` reconstructs the
window from the event log, where every step shares one prompt id.

1. **Act.** Base scene, WebGPU bootstrap, three browser tests for AC-01 to AC-03.
2. **Verify.** 2 passed, 2 failed — both with zero non-black pixels in the readback.
3. **Observe.** The evidence contradicted the obvious diagnosis: AC-02 measured six hundred
   real frames and `__VERBO_STATE__` was populated, so the renderer was demonstrably running.
   **A scene that renders and reads back black is not a broken scene; it is a broken reading.**
4. **Fix.** The test drew the canvas from *outside* the animation loop. Presentation does not
   survive the frame, and in headless it never reaches the compositor at all — which was
   already written into the spec as a constraint on the *shadow* renderer. It is a fact about
   WebGPU presentation, and the scope was too narrow. Capture moved inside the loop.
5. **Verify.** 4/4 passing.

The fix is load-bearing beyond the test: reading pixels from inside the loop is exactly the
mechanism L3 needs, so a bug in the acceptance suite produced the seam the harness was going to
require anyway. What stopped it becoming an hour of chasing the renderer was that two other
signals disagreed with the failing one. **A single red test invites you to fix the thing it
points at; three signals that contradict each other tell you where to look.**

---

## 2 Sep — Integration found two defects isolation could not

Five workstreams each passed their own verification alone. Wiring them together against a
real renderer surfaced two defects that exist only *between* them.

**A silent no-op.** `reconcile()` iterated the primitive registry with
`Object.values(primitives)`. The registry is a `ReadonlyMap`, and `Object.values()` on a
Map returns `[]` — so the loop ran zero times and no visual binding was ever created. It
typechecked, it built, and it rendered a base scene that would never have shown an
injected primitive. It surfaced because a *different* consumer declared the type it
actually wanted and the compiler objected: the bug was found by a type error in an
unrelated file.

**Double registration.** The cycle called `mount()` and then `register()`, but `mount()`
registers with the world itself. Every candidate threw *"instance already registered"*, so
all three strategies failed and the cycle reported a clean `all candidates failed`.

**What made it cheap.** The log named which layer rejected, which strategy, and the
verbatim error. Diagnoses as actionable prose rather than scores was a rule written for
the repair agent's benefit; it paid off first for a human.

**What to keep.** Contracts prevented the workstreams from *colliding*; they did not make
their assumptions about each other true. Freezing an interface buys parallelism, not
agreement — the end-to-end test buys agreement.

---

## 2–3 Sep — The evaluation disagreed, and the corpus was not edited

The nightly evaluation drives the real application through a browser rather than
re-implementing the pipeline in Node, because an evaluation that exercises a parallel copy
of the system measures the copy.

**Night one: 14 of 15 as expected.** The disagreement was worth more than the agreements.
`"make it rain money"` was **accepted**: the resolver matched `rain`, satisfied its
contract, and reported success — while the salient word was never addressed and never
mentioned.

That is not a matcher bug. It is a missing product decision, and it is the same failure the
brief names — *claiming work is complete without meaningful verification* — appearing in
the intent layer rather than the harness.

**Decision: accept and disclose.** Refusing a request the world can partly satisfy is worse
service; delivering a subset in silence is indefensible. The unmet part travels with the
intent and reaches the user.

**Where it is enforced.** Structured output guarantees the *shape* of a response, not its
*meaning* — a schema cannot stop a model answering a different question. Two consequences:
primitive names are an **enum built from the catalogue**, so a name outside it is
unrepresentable rather than rejected downstream; and **`unaddressed` is a required field**,
because the one thing a schema can do about meaning is force the model to state what it did
not do.

**The correction the evaluation then forced.** First run after the change: 14/17, with all
three disclosure cases *"accepted silently"*. Only the model-backed resolver emitted
`unaddressed`, and the offline path is what a reviewer runs. A property that holds only on
the paid path cannot be defended by the offline suite. The keyword resolver computes the
field too — less precisely, and honestly. 17/17.

**What was deliberately not done, twice.** The corpus was never edited to match observed
behaviour. Changing the expectation to fit the result is how an evaluation stops being one.
The disclosure cases became their own category requiring acceptance **and** a non-empty
disclosure.

---

## 3 Sep — What written context is worth, measured

Two agents, same task (add a `lightning` primitive), same repository, same success
criterion. One was given `CLAUDE.md`, the spec and the contracts; the other had to infer
the conventions from source alone.

Deliberately **not** an orchestration A/B — that would mean building the project twice.
Context is the one variable isolable honestly: identical task, identical repo, one input
removed.

| Run | Tool calls | Files | Tests added | Outside scope |
|---|---|---|---|---|
| **A** — with written context | 54 | 5 | **11** | none |
| **B** — source only | 41 | 6 | **0** | one unrelated file |

**The result contradicts the obvious hypothesis.** Written context did not make the agent
faster — the guided run used **33% more** tool calls. What it produced was thoroughness and
boundaries: eleven test cases against zero, and no file touched outside its remit.
Guidance is not a shortcut; it is a specification of what "done" means, and meeting a
higher bar takes longer.

**On the experiment's integrity.** B reported, unprompted, that the harness auto-injected
`CLAUDE.md` into its context late in the run, after the implementation was written. The
contamination pushes *against* the measured effect, so the real gap is wider than the table
shows. An experiment whose known flaw biases toward the null result is more credible than a
spotless one.

---

## 4 Sep — The screenshot was one command away

The plan named one risk above all others: that the base world would not be beautiful, and
that this is the one thing engineering cannot compensate for. It also set a rule — if it
does not impress, change it, do not hope. Then the scene was built, the question was
recorded as unanswerable because it was aesthetic, and a day passed.

That was wrong for an unsubtle reason: Playwright was already installed, the app already
exposed in-loop frame capture built for the acceptance tests, and images can simply be
looked at. **The check was free.**

What the screenshot showed: flat grey boxes on a flat grey plane, every pixel inside a
two-stop value range, no light source in frame, rain rendering as static dots.

What fixed it was value range and a light anchor, not more geometry — a sky gradient baked
into vertex colours (raw GLSL is not dependable under `WebGPURenderer`, and a sky that
silently falls back to a flat fill is the worst kind of failure); a moon actually in frame,
because without a visible source a directional light reads as an arbitrary tint; buildings
pushed to near-black so they read as silhouette; rain as line segments rather than points.

One artifact worth naming: the ground used `metalness: 0.62` against a 2.1 key, clipping a
specular lobe to pure white directly in front of the camera. **The brightest thing in the
opening frame was a mistake.**

---

## 4 Sep — The advisory layer earned its place

L3 rejected a candidate on screen, for a true reason:

> *the frame changed by 0.194% of pixels, below the 0.2% floor. State satisfied its
> contract but nothing became visible.*

Both halves of the design worked at once. The layer caught a real defect **and was
structurally unable to act on it**, exactly as required. What it caught was not a code bug:
`tower` passed every authoritative layer and mounted correctly. It was **too small to see** —
one slender tower at the far end of a 260-building skyline. A verb whose result nobody can
notice has not run.

That is the argument for an advisory layer that cannot veto. A vetoing critic would have
blocked a correct implementation over a product judgement; a critic with no voice would
have let an invisible feature ship as a success.

**Three dead bindings, found the same week.** `fogBinding` read `slice['colour']` where the
field is `color`; `rainBinding` read `fallHeight` where it is `spread`; `windBinding` read
`vector` where it is `direction`. All three ran silently on their fallbacks. The contracts
assert over *state* and the bindings read state by string key: the state was always right;
the picture was reading a key nobody wrote. L2 could never catch this — it verifies that
the world is correct, not that anyone can see it.

---

<a id="f3"></a>

## 9 Sep — Twelve attacks, twelve escapes

Twelve hostile candidates were written and run through the real L0. **All twelve passed.**
Computed global access, `import()`, aliasing the state root, destructuring a global, a
computed `register()` path, the `Function` constructor via `(()=>{}).constructor`.

The cause is structural, not a missing case. L0 checks identifier *names*, and
`globalThis['fe' + 'tch']` names nothing. No AST walk keyed on identifiers can ever see it,
so the list of forbidden globals was never a boundary — **it was a spell-checker.** And the
spec claimed more than the code did: AC-05 and §4.1 were true only of code that was not
trying.

**The fix is not a better parser.** `revokeCapabilities()` deletes `fetch`,
`XMLHttpRequest`, `WebSocket`, `importScripts` and the rest from the probe worker's own
global before the candidate is imported. The question stops being *"did you ask for this"*
and becomes *"is this here at all"* — and a capability that is absent cannot be reached by
any spelling.

Eight of the twelve are now caught at L0 anyway, because catching drift in five
milliseconds with an actionable diagnosis is worth having. The other four are kept **as
tests of what L0 does not claim**: the next spelling is always one character away, and a
check that loses that race quietly is worse than one that never claimed to run it.

The browser test proves the distinction rather than the outcome. The candidate spells
`fetch` at runtime and reports which failure it got: *"fetch is absent"*, not
*"REACHED_NETWORK"*. A test that only asserted "it failed" would pass under either.

### Auditing the suite by breaking the code — and getting the audit wrong twice

The harness had now been wrong about itself three times, always the same way: a layer
reporting success on a weaker statement than the one written down. None was caught by its
own tests, because **a test written from the same understanding as the code inherits its
blind spot.**

So: break seven load-bearing lines on purpose and ask which tests notice. A mutation that
*survives* names a line nothing is holding.

**First run: 5 of 7 caught. Both survivors were faults in the audit.** The first mutation
left the real `sort()` in place after the noise, so it changed nothing and "survived" for
the wrong reason — the same failure as the mutation engine, committed again by the person
who fixed it. The second was verification theatre: the replacement test passed identically
under correct and weakened code, because the two assertions sat on different fields and the
mutant never touched what the other watched. Putting both on the same field produces two
answers for two different reasons, which is the whole requirement of a test that holds a
line.

**7 of 7.** `npm run audit` is a command now, so the next line that stops being held says so
out loud. The lesson is narrower than "write better tests": **a test is only evidence if
some change to the code would break it**, and the cheapest way to find out is to make that
change.

---

## 13 Sep — The advisory layer went first, and found four defects

L3 had existed since day nine and had never looked at anything: written, tested against a stub,
and unreachable from the running app. Every verb logged *"no visual critic configured"* — honest,
and an admission that a quarter of the harness was decorative.

Its first live judgement, on a request for a stormy night:

> **L3** — Nothing in the frame reads as a night scene: the image is overwhelmingly
> white/bright.

True, and a defect nothing else could have caught. The resolver had read the request correctly
and then returned `daylight` with `{}` for parameters, which the compiler filled with defaults —
and the default phase for `daylight` is midday. A storm at noon, from a model that had just
written down that it was night.

**The cause was the schema, not the prompt.** `params` was an open `z.record`: valid JSON Schema,
and it declares no field names, so a model generating into it is handed an object with no boxes
and closes the brace. Confirmed rather than assumed — with the full catalogue in the system
prompt, an explicit *"never `{}`"*, and effort raised to high, every parameter still came back
empty while the composition itself was correct.

Naming them fixes it, and naming all fifteen at once is impossible: three shapes were refused
with *"The compiled grammar is too large"*. A bisect put the ceiling between eight and eleven
keys, which is the shape of a factorial — **constrained decoding admits an object's keys in any
order, so k required keys cost k! paths**, and it multiplies down the tree. Resolution is two
calls now, split where the reasoning already divides.

### The critic was judging a picture of its own PNG

Its next verdicts were confidently wrong: *"nothing but horizontal noise bands on a white
background"*, of a night city that had rendered correctly. The browser encoded the frame to PNG;
the proxy read those bytes straight into `frame.data` as though they were RGBA and encoded them
again. The model was shown a picture of a compressed byte stream and described it accurately.

Nothing threw, because a 160×90 frame is 57,600 bytes and its PNG came to 57,758 — close enough
to fill the array and never look wrong. **A coincidence of size is the entire reason that
survived being written.**

### Four real defects, and the one worth recording

Fog was declared 0.001–0.2 and the binding divided by an implied 1, so every fog the model could
ask for was no fog. The aurora rendered correctly and invisibly, at seven degrees of elevation,
behind the towers. A slow dawn sat visibly unchanged for most of a minute.

The fourth is the instructive one. *"No water is visible"*, three times, over a primitive that
was working: its state was right, the mesh was in the scene, and a material painted magenta put
no magenta pixel on screen. The camera pitched up 32° with a 54° field, so **the frame ran from
+5° to +59° of elevation and everything at or below the horizon was off the bottom of it.** Not
a rendering bug — a framing one. Three correct renderings of the wrong shape, and L2 was
satisfied every time, because the state was right and **the state is not the picture.**

### Two harness faults behind the complaints

The aurora failed again after being fixed, because L3 captured its frame thirty milliseconds
after the mount and `aurora` takes three and a half seconds to brighten from a deliberate
`glow: 0`. The critic was accurate about a frame of a world that did not exist a second later.
The cycle waits for arrival now, on the `mix` convention the primitives already shared — and
four files agreeing by habit is not an interface, so a test holds them to it.

And `slice['colour']` beside a primitive publishing `color` is not a type error, not a runtime
error, and not a visible failure: the binding reads `undefined`, falls back to its default, and
draws something plausible forever. It had happened five times, each found by eye, late. A test
now reads the bindings instead of trusting them — the TypeScript AST gives every `slice['key']`
in every factory, mounting the primitive gives every key it publishes, and the first must be a
subset of the second.


<a id="f4"></a>

## 13 Sep — Telemetry blind to 95% of its own verifications

Judged from the outside, the autonomous-loop evidence was the weakest artifact in the
submission: prose describing four loops, where what is asked for is something a reviewer can
verify. **A paragraph saying a loop closed without a human in it is not evidence of the
absence of a human.** Only a record kept at the time can settle it.

The record existed and had never been used for this. Every lifecycle event carries the id of
the human prompt whose turn it belongs to, which makes the absence *mechanical*: if the
failing verification, the edits that answered it, and the passing verification all share one
prompt id, no new instruction arrived between them, because there is nowhere for one to have
gone.

**The first version found eight loops. It was wrong.** The verification pattern matched
anywhere in the shell string, so a heredoc writing a test file counted as running one.
Evidence that looks like evidence and is not is worse than none — a reviewer who reads it
carefully trusts everything else less. Tightened to commands that actually invoke the
harness, **eight loops became one.**

### Why, and it is the finding

`npm run verify` exits non-zero when it fails. 127 verification invocations are in the log.
**121 of them — 95% — were piped through `tail` or `grep`**, because that is how you read
the output of a command that prints four hundred lines. A shell pipeline exits with the
status of its *last* command, so every one of those reported success.

The log recorded 2 failures out of 127 — not because the suite was green 125 times, but
because the exit code was being discarded by the habit of trimming output in order to read
it.

**A record that can be silenced by how a command was invoked is not back pressure.** This is
the component whose entire purpose is machine-readable feedback, and it had been blind for
twelve days, in a project whose central argument is that agents need feedback they cannot
talk their way around.

The repository's own rule decides the fix: *if you find yourself writing "the agent should
remember to…", make it impossible instead.* The verify chain now writes its own outcome to
`.verbo/verify.jsonl` from inside `npm run verify`, where nothing downstream can hide it.

One loop provable with a mechanical argument is worth more than four with a narrative, and
the reason there is only one is now a fixed defect rather than an unexamined number.

---

## 13 Sep — The evidence was not in the repository, and shipping it would have leaked a key

Working through the submission requirements, reproducibility turned up something worse than
a low score. `.verbo/events.jsonl` and the nightly evaluation results were in `.gitignore` —
and those two files are the parallelisation and autonomous-loop evidence the submission
requires. Every tool that reads them would have run on a reviewer's clone against nothing.
**Evidence that exists only on the machine that produced it is not evidence; it is a claim
with a script attached.**

Then the second thing: **58 lines of that log contained a live API key in plaintext.** The
evidence layer records every command, and a command is exactly where a key ends up. The leak
was not hypothetical — it was scheduled, two files away from being pushed, in the one
artifact the submission is required to include.

The available fixes were "redact before publishing" and "never write it down". A redaction
step at publish time is a step somebody has to remember, and this project's argument is that
the things somebody has to remember become defects. The stripping happens in `log-event.sh`
**at write time**, where the raw value never reaches the file — key-shaped strings for
Anthropic, GitHub and AWS. The existing 3,954 lines were redacted in place and re-validated.

**The failure was structural and invisible.** Nothing was wrong with the hook, the log, or
the gitignore taken one at a time. The defect existed only at the intersection of three
correct decisions — record everything, keep the big file out of git, ship the evidence — and
it would have surfaced as a leaked credential in a public repository rather than as a
failing test.

---

<a id="f5"></a>

## 13 Sep — A citation that did not support the claim built on it

The most load-bearing sentence in this project is R-2. Every argument for the architecture
runs through it: L2 decides correctness, L3 is advisory, `inject()` will not compile with a
verdict that failed the authoritative layers — all of it because external visual scoring was
supposed to have been *measured* as insufficient.

R-2 claimed three figures from WorldCoder-Bench: a Kendall τb of −0.02 over 1,434 pairs, an
agentic visual evaluator costing ~400× more, and that evaluator passing 45.6% of severely
defective outputs.

The paper was fetched. **None of the three is in it.** The benchmark is real and R-1's
figures check out exactly — 27.8% and 19.9%. R-2's did not exist.

This is the worst class of defect a submission can carry. A reviewer who checks one citation
and finds it unsupported does not check the second; they discount everything. And they would
be right to: **a sourced constraint is a promise that somebody looked.**

**The correction makes the argument better, which is the part worth sitting with.** What the
paper does say is that failures are dominated by state-schema drift rather than missing scene
elements. The fabricated version argued *the judge is unreliable*. The real finding argues
something sharper: *the failures are not where a picture can show them.* And the paper's own
protocol verifies hidden runtime state with mutation-hardened contracts — the same design
this project arrived at independently, which is convergence with the benchmark's method
rather than an inference from a statistic.

R-2 was rewritten in the SPEC, along with D-1's rationale, the README, `SYSTEM.md` and four
source files whose docstrings repeated the numbers. Nothing in the code changed: the
architecture was right for a reason that had been stated wrongly.

**The lesson is narrow and expensive: a number with a citation next to it is not a sourced
number.** This harness exists because generated work asserts things confidently. It had never
been pointed at the project's own prose.

---

## 13 Sep — Opening the lock, deliberately and on the record

A second surface shipped: `verbo:figure` takes a rig of typed shapes and a pose function of
time, and the function is *written* rather than chosen — spliced into the generated module as
source and parsed by L0 like anything else. It answers the question the catalogue could not:
a request for a person walking a dog previously met "cannot express", which is an honest
refusal and also the product admitting it is a lighting desk.

That refusal had a second cost: **a closed catalogue left the harness guarding code that was
never dangerous.** Composing validated parameters into a template cannot go interestingly
wrong, so four oracles, a mutation hardener and a capability-revoking worker were defending
against a threat the architecture had already removed.

**Why this is not what D-2 rejects.** D-2 rules out free-form Three.js generation because the
state of the art is measured at 28% on that task. A rig cannot import three, reach the scene
graph, build a material, or name a geometry outside the allowed set; what it writes is
arithmetic returning numbers, and every number is clamped on the way into state.

`docs/SPEC.md` is protected by a `PreToolUse` hook with exit code 2, and the hatch is
`VERBO_SPEC_UNLOCK=1` — explicit, human, and logged. It was used, and this is that log. What
went in: §4.5 describing both surfaces and what each may reach; D-10 recording the decision,
its rejected alternatives and its cost; and AC-21/AC-22, because a capability with no
acceptance criterion is a capability the gate cannot see.

**The lock exists so an agent cannot rewrite the requirements to make its own implementation
look compliant.** Opening it to record a decision is the hatch working; opening it to delete
an AC that could not be passed would be the failure it was built to prevent. The difference
is not in the mechanism, it is in what is written — which is why the entry names its
alternatives and its cost rather than only its rationale.

**The validator caught its own author.** First run, all three candidates, before anything
reached the world: `FigureValidationError: duplicate part id 'head'`. The pair rig is a person
and a dog, and both have a head — a bug written into the library ten minutes after writing the
validator that refuses it, which is the only kind of evidence worth having that the validator
works.

---

## 13 Sep — What actually made the render look cheap

Three review passes converged on the same shape of finding: the defects were never in the
parts of the renderer that can be reasoned about.

**Silhouette, texture scale, camera height.** A building was one `BoxGeometry` scaled three
ways — precisely the shape the word "blocky" names, and no texture or rim light repairs a
silhouette. Buildings became two to five volumes by archetype, with tiers expressed as
*fractions* of height so `skyline-shift` carries them. The window was scaled to the building,
because a cube's UVs run 0–1 across a face whatever it measures: near towers wore windows three
times the size of far ones. In a real city the window is the constant, so the facade is mapped
in world units. And the nearest buildings started at 24 units against a viewpoint at 35, so the
ones closest to the eye were the ones it looked *down* on — **standing in a city rather than
hovering over one is mostly a question of what is taller than you.**

**No shadows, one material, and a fill light half as bright as the key.** `castShadow` appeared
nowhere: a bright moon over eighteen hundred volumes and not one threw anything. All of them
shared one colour and one roughness — not a decision anybody made, but what you get when a city
is a single `InstancedMesh`. And the key was 1.15 against an ambient of 0.5, which is why the
shadows that had just been switched on could not be seen: **a shadow is the absence of the
key**, and if the key is only twice the fill there is nowhere to darken to.

These are one mistake with three faces: **the image had been tuned without questioning the
lighting model underneath it.** Bloom, vignette, grain, tone curve, facade texture, streets —
every one is a layer applied *to* a render, and post-processing a flat scene produces a graded
flat scene.

**The city had no plan, and a part was not the size it said it was.** Buildings were scattered
through an annulus at random angles — boxes thrown at a disc, which caused four symptoms at
once: no streets, because there were no gaps for streets to be; nothing well placed, because
nothing was placed; rigs landing inside towers; trees with nowhere to stand. Separately, the
radius of a capsule, cylinder or cone was `max(x, z)`, so a torso authored `[2.6, 3.4, 1.7]`
became a sausage of radius 2.6 — and at that radius **it swallowed its own arms**, which the
pose had placed 5.5 units off the centre line. Every rig had been built against a renderer that
quietly disagreed with the prompt about what `size` meant.

### The vocabulary was the reason figures were shapeless

In low-poly work **the silhouette is the object.** The shape vocabulary was box, sphere,
capsule, cylinder — every one a blob, none with a direction. Asked for an aeroplane, the model
could only answer with boxes; it had been handed an alphabet with no consonants. Four
directional shapes — `cone`, `wedge`, `pyramid`, `torus` — and the same request came back as a
capsule fuselage, a cone nose and five wedges.

The first `wedge` was a `CylinderGeometry` rotated and then scaled, which stretched the
*triangle's radius* rather than the prism's length, because after the rotation the axis being
scaled was no longer the axis intended. It did not throw. It produced thin white spars, and the
first thing to notice was L3: *"the only non-building geometry is a set of thin white spars"*.

### A threshold that had moved four times

`"a taller denser city"` failed after each render change, and its threshold had already been
loosened twice. The metric counted dark pixels — an *area* proxy — and setbacks add mass low and
take it away high. **Three recalibrations of one threshold is a metric telling you it is
measuring the renderer rather than the verb.** Changed to skyline *height*, it then fell to
1.35× while area doubled to 2.30×, because density on a street grid fills blocks rather than
scattering towers. **Chasing whichever number is highest is how a test becomes a formality.**
The verb says two things, so it gets two assertions, and neither half can be satisfied by the
other.


## 13 Sep — Physics with an invariant, and a budget measured on the wrong window

`debris` is the first primitive whose correctness is a *law* rather than a preference.
Everything else is judged against what someone decided it should do. This one integrates:
gravity, velocity, restitution, and a ground that takes energy out of every bounce.

Which gives L2 something no other primitive can offer. **Total mechanical energy falls
monotonically**, because a semi-implicit integrator with restitution below one is dissipative.
That invariant is invisible in a screenshot: a world that *gains* energy every bounce does not
look broken, it looks livelier, right up until the bodies leave the frame. It is exactly the
failure the benchmark reports as dominant — hidden state drifting out of agreement with a scene
that still looks plausible.

Verified against the bug it exists to catch, not assumed. Switching to explicit Euler — the
classic mistake — renders beautifully and fails by name: `energy rose on 39 frames, worst by
13.343`. The mirror is asserted too, because a pile frozen at its starting height also never
gains energy and would pass.

### The budget was being charged for work it does not name

R-8 says **≤ 40 s from utterance to injection**. L3 runs *after* injection — it is advisory and
never blocks — and its latency had been charged to a budget written for the moment the world
changes. By the time the critic speaks, the subject has been moving for five seconds.

Two further findings came out of the same measurement. The two model calls did not depend on
each other and had been running in sequence for no reason beyond authoring order; run together,
with the offline keyword resolver used as a free local predictor of whether the rig author is
needed at all, **75 s became 45 s**. And the first measurement attempted put injection at 0.1 s,
because the cycle's own clock starts *after* the resolver has answered. Three different windows,
and only one of them is the one the constraint is about.

### A suggestion that degraded as the vocabulary grew

Adding `debris` broke an unrelated test: a request for a talking dragon began being answered
with *"the closest thing the catalogue can do is debris"*. **"talking" and "falling" differ in
two characters out of seven** — score 0.71, over a bar of 0.7. Edit distance is inflated by
shared suffixes, and a suggestion built on a rhyme is nonsense.

What is worth keeping is not the fix. It is that **the quality of that suggestion degraded as
the vocabulary grew, and nothing was watching it.** The only reason it surfaced is that an
unrelated test happened to use a word rhyming with a new one. That is luck, and luck is not a
verification strategy.

---

## 13 Sep — An effect removed, and an attack corpus that corrected its author

`three/addons/tsl/display/` ships anamorphic lens streaks — the single most recognisable
signature of a photographed night city, and this world is several thousand points of light
against near-black. Three settings, three failures: correct and invisible; every window
streaked into a purple wash; and a base scene that looked right while the same verb washed out
again.

That third result is disqualifying, and not because of tuning. **Fog raises the luminance of
everything and the threshold is absolute** — so the correct setting depends on which verbs
happen to be in the world. In a product whose premise is that the world changes on request,
that is not a setting; it is a defect waiting for a demonstration. Removed.

It was nearly kept for being cheap, and then nearly blamed for a cost it was not causing: frame
rate drops from 120 to 73 with weather in the world, and does so with the pass removed too.
Both mistakes are the same mistake — **attributing a number to the thing you happen to be
looking at.**

**The corpus corrected its author on its first run.** Two new attacks were written and labelled
as escaping; the run reported a mismatch, because L0 catches them. The name is assembled at
runtime and unreadable, but the *object* is spelled `globalThis`, which is very readable. The
lint is better than assumed at the one thing it does check, and a weaker claim about the system
than the truth was about to be published. `npm run attack` now prints which layer stops what —
ten refused by the lint, two left to the worker. **Saying which two is the point:** a harness
claiming twelve of twelve would be claiming its lint is a sandbox, and the first person to try
would find out it is not.

---

## 13 Sep — The facade stopped being an image

The building facade was a 512×1024 canvas drawn once and tiled across every building. Three
costs a procedural one does not pay: **it repeats**, and at this density the eye finds the seam;
**it is a fixed resolution**, so close to the camera a window is four blurry texels, and the mip
chain that stops it shimmering is the same chain that smears it; and **it is one facade**, so a
curtain-wall tower and a pre-war block were the same image at different tints.

The windows are arithmetic over world position now. The grid is in world units, so a window is
the same size on every building whatever its face measures; lit cells come from a hash of the
cell's own coordinates, so the pattern never repeats and never needs to be stored; and the
storey *pitch* is hashed per parcel, so a tower with tall floors stands beside one with short
ones. `mx_cell_noise_float` is three.js's own cell hash — deterministic and stable across both
backends, which matters because the WebGL2 fallback compiles the same graph.

Occupancy is still per floor before per window, which is the one thing the canvas version got
right: offices empty a floor at a time, and a per-window roll alone produces a static of lit
squares no building has ever shown. The canvas is deleted rather than left in place — a texture
nothing samples is a 512 KB upload and a lie in the next person's mental model.

---

<a id="f6"></a>

## 14 Sep — The critic was judging the wrong frame, and the world had no scale

Six findings in one session. The first is the most serious thing the harness has been wrong
about.

### L3 could not see the subject it was asked about

The perceptual critic kept reporting *"there is no human figure"* about frames that contained
one. The cause was ordering, not eyesight: the camera was pointed at a new rig from the
`accept` step, and **L3 judges a candidate before it is accepted.** The one layer that looks at
pictures was photographing the skyline it was about to leave — on every figure request ever run.

The camera now follows the world's published state: a subject in state is a subject to frame.
That is the rule the framing code above it already stated, and it needs no cooperation from the
cascade — a candidate mounted for review is in state, so it is framed, so it is what gets
judged. The verdict on a person walking a dog went from *"no human figure and no dog"* to *"the
rear-view person with a small dog beside them reads clearly"*. The shot also publishes its own
arrival ramp under `mix`, so the cycle waits for the move to land with no special case for
cameras.

### The world was metric and the figures were not

The city is metric — a street tree's trunk is 9 units, a road is 11 across, the shortest
building is 26 — and rigs are authored at "about 40 units tall", because that is the only scale
a model can hold in its head alongside a thousand-unit city. The result was a pedestrian taller
than an eight-storey block. `FIGURE_SCALE` converts once, on the rig's root transform.

That exposed two more inconsistencies. The validator's bounds were still in the old scale — a
`MAX_SIZE` of 40 authored units is 1.8 m, so a bus could not be built and nothing could fly
higher than 18 m — and **both tests asserting those bounds had copied the numbers, so they
stopped testing the bounds the moment the bounds moved.** They are exported now and the tests
read them.

### Three faults in how rigs were placed and moved

Setting a part's position *and* its rotation independently is a contradiction: rotating a
segment about its centre moves both of its ends, so the elbow the upper arm reaches is not the
elbow the forearm was placed at. The gaps opened and closed through the stride, which is why
they read as the rig coming apart rather than as a constant offset. A joint is computed once
and the next segment hung off it — and both components of that offset take a minus, where
writing the y term as a subtraction and the z term as an addition hinges the joint sideways.

Every figure in the catalogue was authored with the same origin, because each was written and
looked at on its own, so two requests put both rigs on the same three square metres pacing the
same line through each other. **Nothing in state was wrong**, which is why no oracle caught it
and why it needed a test. Stations are claimed by name on a phyllotaxis spiral, and the test
measures how far each rig actually strays over a full cycle of its own animation, requiring the
stations to be further apart than the sum of those reaches.

And the walk reversed by setting `facing` from 0 to π between one frame and the next. No
smoothing fixes that, because the path has a cusp: **a body walking a line has to stop to turn,
and a rig cannot stop.** An oval has no cusp — heading is the direction of travel, defined and
continuous at every instant, and the turn happens because the walker is walking a curve.

### Two defects found only by using the product

`Escape` was the documented way back to the wide shot and was unreachable: it was guarded on
"not currently typing", and the prompt holds focus after every utterance. The one key that
leaves a close shot never fired for anyone who had just said something.

And on the published site — static, no proxy — only the resolver had a browser path for a
visitor's own key. The critic and the rig author were proxy-only, so a visitor with a key got
Claude resolving their sentences and a 405 on every judgement. **Three quarters of what this
project argues was demonstrable only on a machine running a server**, which is the one place it
needs no demonstrating.

### CI verifies what a GPU-less runner can honestly verify

The first CI run failed 18 of 26 browser tests. Not a missing GPU — the scene rendered, and the
WebGL2 fallback test passed. A hosted runner's WebGPU is SwiftShader, which comes up and then
drops the device mid-run, after which every frame capture waits on a device that is gone.
Forcing the WebGL2 path instead does render, and took 27.5 s to first frame, so the whole suite
then sat on the wrong side of every timeout — turning 18 failures into 23.

Either way CI would be measuring a software rasteriser rather than the product, and the way to
make it green — loosen the timeouts until a rasteriser passes — is the exact failure this
project exists to argue against. CI runs typecheck, the unit suite and the acceptance gate, and
**the workflow states why the browser suite is not among them** rather than omitting it in
silence. That suite runs where there is a GPU, which the contributing rules already require
before anything is reported finished.

---

## ⏳ Pending

Recorded as absent so their absence is not mistaken for omission:

- **The injection policy decision** — what may auto-inject and what requires approval.
- **More failures during implementation.** They will be worth more than any of the successes.
