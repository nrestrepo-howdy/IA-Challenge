# Demo — shot list

Three minutes, hard cap. Roughly 90 seconds on what it is, 90 on how it was built.

**The rule for the first half: no architecture.** Not one diagram, not one word about
oracles. Let the viewer spend ninety seconds wondering *how*, because a question they are
already asking is the only thing that makes the second half land.

**Record against the live URL with your own key pasted in.** Without a key the site
answers from the built-in phrasebook in milliseconds, which is real and demonstrates the
wrong half. The field is bottom-right; the status line reads `KEY ACTIVE` once it is set.

Record twice. Have someone who did not build this drive the keyboard for take one.

---

## 0:00 – 1:30 · What it is

| Time | Shot | Say |
|---|---|---|
| 0:00 | Full screen. The world already alive — moon, city, slow orbit. Say nothing for three seconds. | *(silence)* |
| 0:08 | Type **`make it rain`**. Do not cut. | "You tell the world what to become." |
| 0:14 | It rains. The camera keeps orbiting; nothing reloads, nothing blanks. | "It didn't reload. Your world is still your world." |
| 0:25 | Type **`una noche de tormenta`** — in Spanish, and the name of nothing. Talk over the wait. | "Nothing in that sentence is a primitive. It's a mood — and it becomes night, heavy rain, wind driving the rain sideways, lightning. Four things composed, because that is what the sentence meant." |
| 0:45 | Point at the `import` lines in the panel's code view. | "Every one of these is code that did not exist a second ago." |
| 0:52 | Type **`un astronauta caminando por la plaza`**. It takes 10–60 s. **Start talking immediately** — do not wait for it. | "That one is not in the catalogue. There is no astronaut. So while it works — there is no dog primitive either, no walk primitive. The agent has to write the body and the gait itself." |
| 1:05 | It lands. The camera comes down to street level to meet it. | "And the camera came down, because the subject of the picture changed." |
| 1:12 | Scroll the code view to the `pose` function. | "This is the only part the agent *writes* rather than selects. It's arithmetic — it cannot import anything, reach the scene, or name a shape outside eight. That narrowness is what makes it safe to run." |
| 1:20 | Click the status line, bottom-left. Paste the URL into a second window. The same world rebuilds. | "The link carries what you *said*, not the code — so a shared world is re-verified when it opens. You cannot hand someone a link that runs something in their browser." |
| 1:26 | Type **`make it rain money`**. It rains, and the log says *cannot express: "money"*. | "And when it can only do part of what you asked, it tells you which part." |
| 1:30 | Hold. | *(silence)* |

---

## 1:30 – 3:00 · How it was built

| Time | Shot | Say |
|---|---|---|
| 1:32 | Say a verb again, but now the **panel top-right** is the subject. Three lanes, four cells each. | "Three different programs were written for that. They raced." |
| 1:40 | Point at the accepted row, then the rejected one, then its diagnosis. | "One cleared every layer. The others were rejected, and the panel keeps them — the failures are the evidence." |
| 1:48 | Point at the **L3** cell, the dashed rule labelled *advise*, and the `L3 —` line in the log. **This is the shot.** | "Three of those four decide. The fourth looks at the actual frame and only ever files an opinion — it cannot block. Read what it just said about the thing it approved." |
| 1:56 | Read L3's line out loud, including the criticism. | "It approved it *and* told me what's wrong with it. A system that only ever congratulates itself is one you can't trust." |
| 2:05 | `docs/SPEC.md`, the constraints table, stop on **R-2**. | "This is the decision the whole thing is built on. A 2026 benchmark measured where generated 3D worlds actually fail — and it is hidden state drifting out of agreement with the controls, not missing things in the picture. Those failures are invisible to anything that looks at a frame." |
| 2:18 | `src/harness/cascade.ts`, highlight `AUTHORITATIVE_LAYERS`. | "So the vision model does not decide. State contracts do — and the type system enforces it. You cannot call `inject` with a verdict that failed L0, L1 or L2, whatever the critic thought." |
| 2:30 | Terminal: `npm run verify`. 465 unit tests, 26 browser, 22/22 criteria. | "The same harness that gates the agent gates every commit and the deploy." |
| 2:40 | `docs/AI-DEV-LOG.md` — **the findings table at the top**. Scroll slowly through the six rows. | "And this is the part I'd actually read. Six findings, and every one of them is a time the verification system was wrong about itself. The mutation engine that mutated nothing. The telemetry blind to ninety-five percent of its own test runs." |
| 2:52 | Stop on finding 5. | "That one is a citation I'd built the architecture on — and when I checked the paper, the numbers weren't in it. It's in the log because a submission you can only trust where it flatters itself isn't evidence." |
| 2:56 | Back to the world. | "One person, fourteen days. The interesting part was never the generation. It was what it takes to make it safe to inject machine-written code into something already running." |

---

## Rehearse against these

Walk it five times looking for the break, not for the flow.

- **Latency is the one thing that can ruin a take.** Measured on the live site with a key:
  `make it rain` ≈ 5 s, `una noche de tormenta` ≈ 16 s, a model-authored figure **11 s to
  67 s** — the variance is the rig author at medium effort. The script talks *over* that
  wait rather than pausing for it. Never open with the slow one.
- **Warm it first.** First load compiles shaders and the opening seconds can hitch. Load
  once, then reload for the take.
- **Say the request once and let it run.** Re-typing mid-wait cancels nothing and the
  second one queues behind the first.
- **Type slowly enough to read.** Fast typing resolves the panel before anyone sees it.
- **Do not narrate over the silences at 0:00 and 1:30.** Both are doing work.
- **The astronaut is the answer to the obvious objection.** Every viewer is privately
  asking whether this only does weather. Ask it for them, out loud, then answer it.
- **Check the L3 line before you commit to reading it aloud.** It is a live judgement and
  it will not say the same thing twice. If it approves without criticism, say a second
  verb — the beat only works when the critique is real.

## Fallbacks

- The live URL is the primary. A local `npm run dev` is the backup; the README's first
  block is three commands.
- **If a verb fails on camera, keep it in.** A rejection with its reason on screen is the
  product working, and a demo where nothing ever fails is the one people disbelieve.
- If the key runs out of credit mid-take, the site falls back to the phrasebook and says
  so in the log. That is honest and it is not the demo — stop and top up.
