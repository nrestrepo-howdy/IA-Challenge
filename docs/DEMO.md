# Demo — shot list

Three minutes, hard cap.

**The shape of it.** The first ninety seconds exist to make the viewer ask one question:
*how is it safe to run that?* The second ninety answer it with something they cannot wave
away. Nothing in the first half mentions architecture — not one diagram, not the word
"oracle". A question the viewer is already asking is the only thing that makes an answer
land.

**The line the whole video hangs on**, said once, at 1:38:

> The model writes the code. The model does not decide whether it runs.

**Record against the live URL with your own key pasted in.** Without a key the site
answers from the built-in phrasebook in milliseconds — real, and the wrong half. The field
is bottom-right; the status line reads `KEY ACTIVE` when it is set.

---

## 0:00 – 1:35 · What it is

| Time | Shot | Say |
|---|---|---|
| 0:00 | Full screen. The world already alive — moon, city, slow orbit. Three seconds of nothing. | *(silence)* |
| 0:06 | Type **`make it rain`**. Do not cut away. | "You tell the world what to become." |
| 0:12 | It rains. The camera keeps orbiting. Nothing reloads, nothing blanks. | "It didn't reload. Your world is still your world." |
| 0:22 | Type **`una noche de tormenta`** — Spanish, and the name of nothing. Talk over the wait. | "Nothing in that sentence is a feature. It's a mood. And it becomes night, heavy rain, wind driving the rain sideways, lightning — four things composed, because that's what the sentence meant." |
| 0:42 | Point at the `import` lines in the panel. | "Every one of these is code that did not exist a second ago." |
| 0:50 | Type **`un astronauta caminando por la plaza`**. Takes 10–60 s. **Start talking immediately.** | "That one isn't in the catalogue. There is no astronaut. No dog, no walk cycle either — so while it works: the agent has to design the body and write the gait itself." |
| 1:05 | It lands. The camera drops to street level to meet it. | "And the camera came down, because the subject of the picture changed." |
| 1:14 | Scroll the code view to the `pose` function. | "This is the only part the agent *writes* instead of selects. It's arithmetic. It cannot import anything, reach the scene, or name a shape outside eight." |
| 1:24 | Type **`make it rain money`**. It rains; the log says *cannot express: "money"*. | "And when it can only do part of what you asked, it tells you which part." |
| 1:32 | Hold on the world. | *(silence)* |

---

## 1:35 – 3:00 · Why it is safe to run

| Time | Shot | Say |
|---|---|---|
| 1:35 | The **panel, top-right**. Three lanes, four cells each. | "Three different programs were written for that. They raced." |
| 1:38 | Point at the accepted lane, then a rejected one, then its diagnosis. | "**The model writes the code. The model does not decide whether it runs.** One cleared every layer. The others were rejected — and the panel keeps them, because the failures are the evidence." |
| 1:48 | Point at the **L3** cell and the dashed rule labelled *advise*. Then read its line in the log **out loud, including the criticism**. | "Three of those four decide. The fourth looks at the actual frame and only ever files an opinion — it cannot block. Listen to what it just said about the thing it approved." |
| 1:58 | Let the criticism land. | "It approved it *and* told me what's wrong with it. A system that only ever congratulates itself isn't verification." |
| 2:05 | **Cutaway, pre-recorded.** The debris primitive bouncing — it looks great. | "So what do the deciding layers catch that looking can't? Watch this. Falling bodies. Looks right." |
| 2:12 | Same scene with the integrator changed to explicit Euler. Still beautiful. Then the terminal. | "Now I break the physics — the classic mistake, reading velocity before the acceleration instead of after. It renders *better*. Bouncier. Livelier." |
| 2:20 | The test output: `energy rose on 39 frames, worst by 13.343` | "Total mechanical energy has to fall every frame. That's a law, not a preference. No eye catches this. The contract catches it by name." |
| 2:30 | `tests/world/rig-integrity.test.ts` scrolling, then its three findings. | "Same idea on the figures. 'Does it look like a dog' is taste. 'Is it one connected body' is geometry — so it's checked, every frame of the animation. It found three defects in rigs I'd hand-tuned and stared at: the walker's feet stayed on the pavement while the leg lifted; the dog's legs left its body every stride; the leash didn't reach the hand." |
| 2:42 | `docs/AI-DEV-LOG.md` — **the findings table**. Scroll the six rows slowly. | "And this is the part I'd actually read. Six findings, and every one is a time the verification system was wrong about *itself*. The mutation engine that mutated nothing. The telemetry blind to ninety-five percent of its own test runs." |
| 2:52 | Stop on finding 5. | "That one's a citation the whole architecture was built on — and when I went and read the paper, the numbers weren't in it. It's in the log because a submission you can only trust where it flatters itself isn't evidence." |
| 2:57 | Back to the world. | "One person, fourteen days. The hard part was never the generation." |

---

## The cutaway at 2:05 — record this separately

Two takes, thirty seconds of footage, cut to fifteen.

1. `npm run dev`, say **`drop some debris`**, record ten seconds of it settling. It looks
   correct because it *is* correct.
2. In `src/world/debris.ts`, move the velocity read to before the acceleration is applied
   — explicit Euler. Record ten seconds. **It looks better.** That is the entire point.
3. `npx vitest run tests/world/debris.test.ts`. Capture the failure line verbatim.
4. **Revert the change.** Confirm `npx vitest run` is green before you record anything else.

---

## Rehearse against these

- **Latency is the only thing that can ruin a take.** Measured on the live site with a
  key: `make it rain` ≈ 5 s, `una noche de tormenta` ≈ 16 s, a model-authored figure
  **11 s to 67 s**. The variance is the rig author. Never open with the slow one, and
  narrate *over* it rather than pausing.
- **Check L3's line before committing to read it aloud.** It is a live judgement and will
  not say the same thing twice. If it approves with no criticism, say another verb — the
  beat at 1:48 only works when the critique is real.
- **Warm the app.** First load compiles shaders and can hitch. Load once, reload, record.
- **Type slowly enough to read.** Fast typing resolves the panel before anyone sees it.
- **Don't narrate over the silences at 0:00 and 1:32.** Both are doing work.
- **The astronaut answers the objection everyone is privately holding** — that this only
  does weather. Ask it out loud, then answer it.

## Fallbacks

- The live URL is primary; local `npm run dev` is the backup, three commands in the README.
- **If a verb fails on camera, keep it in.** A rejection with its reason on screen is the
  product working, and a demo where nothing ever fails is the one nobody believes.
- If the key runs out of credit mid-take the site falls back to the phrasebook and says so
  in the log. Honest, and not the demo — stop and top up.
