# Contratos entre workstreams

La fuente de verdad es [`src/contracts.ts`](../../src/contracts.ts). Este documento
explica **por qué** las fronteras están donde están — que es lo que el rubro puntúa.

| WS | Nombre | Implementa | Consume | Aislado porque |
|----|--------|-----------|---------|----------------|
| 1 | core | `WorldHandle` | `Primitive` | No sabe que existen agentes |
| 2 | runtime | `Injector` | `Verdict`, `WorldHandle` | No sabe cómo se ve nada |
| 3 | harness | `Oracle[]`, `Prober` | `Candidate`, `StateContract` | Contrato puro; se testea sin mundo |
| 4 | intent | `IntentCompiler` | — | Interfaz sin dependencias de render |
| 5 | world | `Primitive[]`, escena base | `WorldHandle` | Puramente visual |

## Por qué estas fronteras y no otras

**core / harness.** El harness verifica candidatos **sin** el mundo real: recibe un
`Candidate` y un `Intent`, devuelve un `Verdict`. Esa frontera es lo que permite
correr los oráculos en un Worker y en headless, y es también lo que permite testear
el harness contra candidatos sintéticos sin abrir un navegador.

**runtime / harness.** El runtime **no puede** inyectar sin un `Verdict`. La firma
lo impide: `inject(c, v)` exige el veredicto. AC-11 —L3 no basta por sí solo— se
cumple porque `failedAt` es explícito y el injector rechaza cualquier veredicto que
haya fallado L0, L1 o L2.

**world / core.** Las primitivas declaran su `statePath`. Esa declaración es lo que
hace posible L2: el contrato apunta a rutas dentro de `__VERBO_STATE__` que existen
porque una primitiva las registró. Sin esta frontera no hay contrato verificable.

**intent aislado.** Compila lenguaje a `(código, contrato)` sin tocar render. Es el
único workstream que puede empezar sin que exista ninguna escena.

## Regla de integración

Nadie modifica `src/contracts.ts` desde un worktree. Un cambio de contrato es una
decisión humana, se hace en `main` con `VERBO_SPEC_UNLOCK=1`, y queda en el event log.
Es la razón por la que cinco flujos paralelos no producen conflictos de merge.
