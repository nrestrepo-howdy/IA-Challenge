# Demo — script

Three minutes. **Explain, demonstrate, prove, close.** The viewer knows what they are
looking at inside the first fifteen seconds; everything after that is evidence.

Narration is written to be read aloud: short sentences, no clauses to get lost in. The
bracketed lines are what is on screen.

**Record against the live URL with your own key pasted in.** Without a key the site answers
from the built-in phrasebook in milliseconds — real, and the wrong half. The field is
bottom-right; the status line reads `KEY ACTIVE` when it is set.

---

## 1 · What it is — 0:00

> [The world, already alive. Moon, city, slow orbit.]
>
> "This is Verbo. It's a 3D city you change by talking to it.
>
> You type a sentence. An AI writes new code. That code is verified by four independent
> layers. And if it passes, it's injected into the world while you're still looking at it.
>
> No reload. Nothing resets."

---

## 2 · What it does — 0:20

> [Type **`make it rain`**. Let it land.]
>
> "Make it rain. Five seconds. And notice what didn't happen — the page didn't reload, the
> camera didn't cut, the city is still the city you were looking at."

> [Type **`a stormy night`**. Talk over the wait.]
>
> "Now something harder. That isn't the name of any feature in this system. It's a mood.
>
> And it becomes four things at once. Night. Heavy rain. Wind pushing the rain sideways.
> Lightning. Composed together, because that's what the sentence meant."

> [Point at the `import` lines in the panel.]
>
> "Every one of those imports is code that did not exist a second ago."

> [Type **`una noche de tormenta`**. Same four things happen.]
>
> "Same request in Spanish. Same four things.
>
> And that one matters, because this system has an offline fallback that works by matching
> keywords — and every keyword in it is English. There is no Spanish in there at all. So
> that sentence can only have been understood, not matched."

> [Type **`an astronaut walking through the plaza`**. Start talking immediately — it takes
> between ten and eighty seconds.]
>
> "This last one isn't a catalogue lookup at all. There's no astronaut in this system.
> There's no walk cycle either. So the agent has to design the body and write the motion
> itself.
>
> While that works, here's the problem this project is actually about."

---

## 3 · Why it is hard — 1:10

> [The astronaut lands. The camera drops to street level to meet it.]
>
> "When an AI writes code today, a person reads it before it runs. There's always a stop.
>
> Here there is no stop. Code goes from not existing to running inside your live session,
> in seconds.
>
> So the only question that matters is: what makes that safe?"

---

## 4 · How it is verified — 1:30

> [The verification panel, top right. Three lanes, four cells each.]
>
> "The model writes the code. The model does not decide whether it runs.
>
> Every request produces three different candidate programs, and they race through four
> layers. One cleared all of them. The others were rejected — and the panel keeps them,
> because the failures are the evidence."

> [Point at the L3 cell and the dashed rule labelled *advise*.]
>
> "Three of those layers decide. The fourth one looks at the actual picture, and it only
> ever files an opinion. It cannot block anything. That isn't a convention — the type
> system won't let you inject a verdict that failed the deciding layers."

> [Read L3's line from the log out loud, including the criticism.]
>
> "Here's what it just said about the result it approved. It approved it, and it told me
> what's wrong with it."

---

## 5 · The proof — 2:05

*Pre-recorded cutaway. This is the fifteen seconds the video is for.*

> [Debris falling and settling. It looks correct.]
>
> "So what do the deciding layers catch that looking can't?
>
> This is falling bodies under gravity. Looks right."

> [Same scene, integrator changed to explicit Euler. Still beautiful.]
>
> "Now I break the physics. The classic mistake — reading velocity before the acceleration
> instead of after.
>
> It renders better. Bouncier. Livelier. No eye catches this."

> [Terminal: `energy rose on 39 frames, worst by 13.343`]
>
> "Total mechanical energy has to fall every frame. That's a law, not a preference.
>
> The contract catches it by name."

---

## 6 · The evidence — 2:35

> [`docs/AI-DEV-LOG.md`, the findings table. Scroll the six rows.]
>
> "The engineering log opens with six findings. Every one of them is a time this
> verification system turned out to be wrong about itself.
>
> A mutation engine that mutated nothing. Telemetry blind to ninety-five percent of its own
> test runs. And a citation the whole architecture was built on — which, when I went and
> read the paper, wasn't in it."

---

## 7 · Close — 2:55

> [Back to the world.]
>
> "One person. Fourteen days. The generation was never the hard part."

---

## The cutaway at 2:05 — record this separately

Two takes, thirty seconds of footage, cut to fifteen.

1. `npm run dev`, say **`drop some debris`**, record ten seconds of it settling. It looks
   correct because it *is* correct.
2. In `src/world/debris.ts`, move the velocity read to before the acceleration is applied —
   explicit Euler. Record ten seconds. **It looks better.** That is the entire point.
3. `npx vitest run tests/world/debris.test.ts`. Capture the failure line verbatim.
4. **Revert the change.** Confirm `npx vitest run` is green before recording anything else.

---

## Rehearse against these

- **Latency is the only thing that can ruin a take.** Measured on the live site with a key:
  `make it rain` ≈ 5 s, a mood sentence ≈ 19 s in either language, a model-authored
  figure **11 s to 79 s**. Never open with the slow one, and narrate *over* it rather than
  pausing. The astronaut is the one that can run long — have a second sentence of
  narration ready for it.
- **Check L3's line before committing to read it aloud.** It is a live judgement and will
  not say the same thing twice. If it approves with no criticism, say another verb — that
  beat only works when the critique is real.
- **Warm the app.** First load compiles shaders and can hitch. Load once, reload, record.
- **Type slowly enough to read.** Fast typing resolves the panel before anyone sees it.

## Fallbacks

- The live URL is primary; local `npm run dev` is the backup, three commands in the README.
- **If a verb fails on camera, keep it in.** A rejection with its reason on screen is the
  product working, and a demo where nothing ever fails is the one nobody believes.
- If the key runs out of credit mid-take the site falls back to the phrasebook and says so
  in the log. Honest, and not the demo — stop and top up.
