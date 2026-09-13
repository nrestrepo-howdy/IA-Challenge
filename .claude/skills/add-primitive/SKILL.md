---
description: Add a primitive to the closed catalogue — the catalogue entry, the world module, the renderer binding and the tests that keep them agreeing.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

## Why this is a skill and not an instruction

Adding a primitive touches four files that must agree about names they never share a
type for. Five real defects have come out of that seam, all of them silent:

- a binding reading `slice['colour']` while the primitive published `color`
- `'snow-emitter': rainBinding` — snow drew rain streaks for a week
- `fallHeight` against a published `spread`, and `vector` against `direction`
- a density range the catalogue declared as `0.001..0.2` and the binding divided by 1

None of these is a type error. None throws. Each one reads `undefined`, falls back to a
default, and draws something plausible forever. The checklist exists because the
compiler cannot hold this seam and a person will not remember it at 2am.

## Current catalogue

!`node -e "const{CATALOGUE}=await import('./src/intent/catalogue.ts');console.log(CATALOGUE.map(c=>c.name).join(', '))" 2>/dev/null || grep -o "name: '[a-z-]*'" src/intent/catalogue.ts | cut -d"'" -f2 | tr '\n' ' '`

## The order, and why it is this order

1. **`src/intent/catalogue.ts`** — the entry first, because it is the specification the
   other three are judged against. Declare `schema` (every param with its range),
   `statePath`, `keywords`, `defaults`, `paramHints` for any word that should move a
   number, and `fields` — one per observable state key, tagged `constant`, `animated`,
   `vector` or `resource`. The `animated` tag is the one that catches "present but
   inert", which is the dominant failure this project exists to prevent.

2. **`src/world/<name>.ts`** — the implementation. Publish *every* field the catalogue
   declares at `mount()`; `assertDeclaredFields` will fail loudly if not, which is the
   point. Ramp in from zero (AC-14) and publish `mix` if arrival takes time. Implement
   `dispose()`.

3. **`src/render/bindings.ts`** — the binding, and register it in `BINDINGS` under the
   catalogue name. Read state keys *exactly* as the primitive publishes them.

4. **Tests** — in `tests/world/` for the primitive. `tests/render/binding-keys.test.ts`
   already checks your binding's `slice['key']` reads against what the primitive
   publishes, by parsing the AST; it will fail by name if they disagree.

5. **`src/world/index.ts`** — add the factory to `createPrimitives`. A catalogue entry
   with no implementation is a build error there, deliberately.

## Before you say it is done

- `npm run verify` — typecheck, unit, browser, and the acceptance gate
- `npm run eval` — the offline corpus, including that `expectSuccess` utterances come
  back **silent**. A new keyword that half-answers an existing utterance is a
  regression the suite will catch and a demo will not.
- If the primitive introduces a new acceptance criterion, it goes in `docs/SPEC.md`
  (protected — `VERBO_SPEC_UNLOCK=1`, and record why in `docs/AI-DEV-LOG.md`).
