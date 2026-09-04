# Demo — shot list

Three minutes, hard cap. Roughly 90 seconds on what it is, 90 on how it was built.

**The rule for the first half: no architecture.** Not one diagram, not one word about
oracles. Let the viewer spend ninety seconds wondering *how*, because a question they
are already asking is the only thing that makes the second half land.

Record twice. Have someone who did not build this drive the keyboard for take one.

---

## 0:00 – 1:30 · What it is

| Time | Shot | Say |
|---|---|---|
| 0:00 | Full screen. The world, already alive — moon, rain-less city, slow orbit. Say nothing for three seconds. | *(silence)* |
| 0:08 | Type **`make it rain`**. Do not cut. | "You tell the world what to become." |
| 0:12 | It rains. The camera keeps orbiting; nothing reloads, nothing blanks. | "It didn't reload. Your world is still your world." |
| 0:25 | Type **`add fog`**, then **`thunder and lightning`**. Let each land. | "Every one of these is code that did not exist a second ago." |
| 0:50 | Click the status line, bottom-left. Paste the URL into a second browser window. The same world rebuilds. | "The link carries what you *said*, not the code. So a shared world gets re-verified when it opens — you can't hand someone a link that runs something in their browser." |
| 1:10 | Type something the world cannot do: **`make it rain money`**. It rains, and the log says *cannot express: "money"*. | "And when it can only do part of what you asked, it says which part." |
| 1:25 | Hold on the finished world. | *(silence)* |

---

## 1:30 – 3:00 · How it was built

| Time | Shot | Say |
|---|---|---|
| 1:30 | Say a verb again, but this time the **panel top-right** is the subject. Three lanes, four cells each. | "Three different programs were written for that. They raced." |
| 1:40 | Freeze on the panel. Point at the green row, then the two grey ones. | "One cleared every layer. The other two were rejected, and the panel keeps them — the failures are the evidence." |
| 1:50 | `docs/SPEC.md`, scroll the constraints table. Stop on **R-2**. | "This is the decision the project is built on. A 2026 benchmark measured that scoring generated 3D by *looking* at it is uncorrelated with whether it works — and that an agentic visual evaluator, at four hundred times the cost, still passes 45% of severely broken output." |
| 2:05 | `src/harness/cascade.ts`, highlight `AUTHORITATIVE_LAYERS`. | "So the vision model does not decide. Hidden-state contracts do. And it's the type system that enforces it — you cannot call `inject` with a verdict that failed L0, L1 or L2, whatever the critic thought." |
| 2:20 | Terminal: `npm run verify`. Let it run. 192 tests, 14 browser, 20/20. | "The same harness that gates the agent gates every commit, and the deploy. There is no separate CI." |
| 2:35 | `docs/SYSTEM.md` §3 — the swimlane chart. | "Five workstreams, in parallel worktrees, against contracts frozen before any of them started. Zero merge conflicts. Those charts are generated from the event log — if the agents hadn't overlapped, no formatting would say they did." |
| 2:45 | `docs/AI-DEV-LOG.md`, the ablation table. | "Two agents, same task, one with the written context and one without. The guided run used **more** calls, not fewer — and wrote eleven tests against zero. Guidance isn't a shortcut. It's a definition of done." |
| 2:55 | Back to the world, still raining. | "One person. Thirteen days. The interesting part was never the generation — it was what it takes to make it safe to inject machine-written code into something already running." |

---

## Rehearse against these

Walk it five times looking for the break, not for the flow.

- **A stale `vite preview`** on the port serves an old build and 404s its assets. It has
  already cost one full test run. `pkill -f "vite preview"` before recording.
- **First load compiles shaders**, so the opening seconds can hitch. Load once, then
  reload for the take.
- **Type slowly enough to read.** The cycle finishes in milliseconds; if you type fast
  the panel resolves before anyone sees it happen.
- **Do not narrate over silence at 0:00 and 1:25.** Both are doing work.

## Fallbacks

- The live URL is the primary; a local `npm run dev` is the backup, and the README's
  first block is three commands.
- If a verb fails on camera, **keep it in**. A rejection with its reason on screen is
  the product working, and a demo where nothing ever fails is the one people disbelieve.
