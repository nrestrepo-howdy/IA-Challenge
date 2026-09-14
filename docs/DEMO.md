# Demo — script

Three minutes, to the submission's own structure: **~90 s on what we built, ~90 s on how
we built it.** Narration is written to be read aloud — short sentences, nothing to get
lost in. Bracketed lines are what is on screen.

Every shot below has been run and its output checked. Where a number appears in the
narration, it is a number that was measured, and the command that produces it is named.

**Record against the live URL with your own key pasted in.** Without a key the site
answers from the built-in phrasebook, which is real and is the wrong half — and the
Spanish beat will fail outright, because the phrasebook has no Spanish in it. The field is
bottom-right; the status line reads `KEY ACTIVE` when it is set.

---

# Part 1 — What we built · 0:00 – 1:30

## 0:00 · What it is

> [The world, already alive. Moon, city, slow orbit. Let three seconds pass.]
>
> "This is Verbo. It's a 3D city you change by talking to it.
>
> You type a sentence. An AI writes new code. Four independent layers verify it. And if it
> passes, it's injected into the world while you're still looking at it.
>
> No reload. Nothing resets."

## 0:18 · It works

> [Type **`make it rain`**. Five seconds.]
>
> "Make it rain. And notice what didn't happen — the page didn't reload, the camera didn't
> cut, the city is still the city you were looking at."

## 0:32 · It composes

> [Type **`a stormy night`**. About nineteen seconds. Talk over it.]
>
> "Now something harder. That isn't the name of any feature in this system. It's a mood.
>
> And it becomes four things at once. Night. Heavy rain. Wind pushing the rain sideways.
> Lightning. Composed together, because that's what the sentence meant."

> [Point at the `import` lines in the panel.]
>
> "Every one of those imports is code that did not exist a second ago."

## 0:52 · It understands rather than matches

> [Type **`una noche de tormenta`**. The same four things happen.]
>
> "Same request in Spanish. Same four things.
>
> That one matters. This system has an offline fallback that works by matching keywords,
> and every keyword in it is English. There's no Spanish in there at all. So that sentence
> couldn't have been matched. It had to be understood."

## 1:06 · It builds what isn't in the catalogue

> [Type **`an astronaut walking through the plaza`**. Ten to eighty seconds. Start talking
> immediately and have a spare sentence ready.]
>
> "This last one isn't a lookup at all. There's no astronaut in this system. No walk cycle
> either. So the agent designs the body and writes the motion itself."

> [It lands. The camera drops to street level to meet it.]
>
> "And the camera came down, because the subject of the picture changed."

## 1:22 · The problem this creates

> "When an AI writes code today, a person reads it before it runs. There's always a stop.
>
> Here there is no stop. Code goes from not existing to running inside your live session,
> in seconds. So the only question that matters is what makes that safe."

---

# Part 2 — How we built it · 1:30 – 3:00

## 1:30 · Five workstreams at once

> [`docs/SYSTEM.md`, the wave-1 swimlane chart.]
>
> "It was built by five agents working in parallel, each in its own git worktree, against
> TypeScript contracts frozen before any of them started. Three live at the same time for
> four minutes and forty seconds. Serial would have taken twenty-one minutes; it took nine.
>
> And that chart isn't drawn. It's generated from five thousand lifecycle events. If the
> agents hadn't actually overlapped, no formatting would say they did."

## 1:45 · The harness gates the agent

> [Terminal: `npm run verify`. 470 tests, 22/22 criteria.]
>
> "Every agent had the same definition of done — this. Four hundred and seventy tests and
> twenty-two acceptance criteria, each one named by the test that verifies it. The same
> command gates every commit and the deploy."

## 1:57 · But who verifies the verifier?

> [Terminal: `npm run audit`. Let the seven lines print.]
>
> "That's the obvious objection: a test suite written by the same process it's checking
> inherits its blind spots. So this deliberately breaks seven load-bearing lines and asks
> which tests notice. A survivor names a line nothing is holding.
>
> Seven of seven. And the first time I ran it, two survived — and both of those were bugs
> in the audit, not in the suite."

## 2:12 · Publishing what it does *not* stop

> [Terminal: `npm run attack`. Stop on the summary lines.]
>
> "Twelve hostile modules, written to get past the static check. Ten are refused. Two get
> through — and it says so.
>
> Those two build a function from a string without ever naming it, so there's no
> identifier to object to. They're stopped by deletion instead: the worker removes eleven
> globals before the candidate loads. Saying which two escape is the point. A harness
> claiming twelve of twelve would be claiming its lint is a sandbox."

## 2:30 · What the contracts catch that looking cannot

> [Two stills side by side, labelled A and B.]
>
> "These two worlds are the same scene. One of them has broken physics. You can't tell
> which, and neither could the visual critic — it gave near-identical notes on both."

> [Terminal: `energy rose on 39 frames, worst by 13.343`]
>
> "Total mechanical energy has to fall every frame. That's a law, not a preference. B is
> the classic integrator mistake, and the contract names it.
>
> That's the whole argument. The model writes the code. The model doesn't decide whether
> it runs."

## 2:48 · The log

> [`docs/AI-DEV-LOG.md`, the findings table.]
>
> "The engineering log opens with six findings, and every one is a time this verification
> system turned out to be wrong about itself. Including a citation the architecture was
> built on — which, when I read the paper, wasn't in it."

## 2:57 · Close

> [Back to the world.]
>
> "One person. Fourteen days. The generation was never the hard part."

---

## The A/B at 2:30 — record this separately

Two stills, captured the same way twice. They are indistinguishable, which is the point —
so frame them identically and do not move the camera between takes.

1. `npm run dev`, say **`bouncing debris`**, wait eight seconds, screenshot. → **A**
2. In `src/world/debris.ts`, move `x += vx * h; y += vy * h; z += vz * h;` to *above*
   `vy -= GRAVITY * h;` — that is explicit Euler, reading velocity before the acceleration
   is applied.
3. Reload, say the same thing, wait the same eight seconds, screenshot. → **B**
4. `npx vitest run tests/world/debris.test.ts`. Capture the failure line verbatim:
   `energy rose on 39 frames, worst by 13.343`.
5. **Revert the change.** Confirm `npx vitest run` prints 6 passed before recording
   anything else.

Measured while preparing this: correct world total energy 33,175; broken 37,781 — and the
critic's note on both was a complaint about framing, not about the physics. That is the
claim, and it was checked rather than assumed.

The camera frames the debris field now, so both stills show a readable pile of bouncing
bodies on the plaza with the lit city behind. If you would rather film it live than cut
stills, that works too — the shot is the same.

---

## Rehearse against these

- **Latency is the only thing that can ruin a take.** Measured on the live site with a key:
  `make it rain` ≈ 5 s, a mood sentence ≈ 19 s in either language, a model-authored figure
  **11 s to 79 s**. Never open with the slow one. Narrate *over* it, and have a spare
  sentence for the astronaut.
- **Warm the app.** First load compiles shaders and can hitch. Load once, reload, record.
- **Type slowly enough to read.** Fast typing resolves the panel before anyone sees it.
- **`npm run audit` and `npm run attack` are the two best terminal shots.** Both print
  clean, readable summaries in under a minute. Run them once before recording so npm's
  own noise is scrolled away.

## Fallbacks

- The live URL is primary; local `npm run dev` is the backup, three commands in the README.
- **If a verb fails on camera, keep it in.** A rejection with its reason on screen is the
  product working, and a demo where nothing ever fails is the one nobody believes.
- If the key runs out of credit mid-take the site falls back to the phrasebook and says so
  in the log. Honest, and not the demo — stop and top up.
