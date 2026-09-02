# Verbo — Especificación de ingeniería

> Estado: v1 · 2 sep 2026 · Autor: humano (decisión no delegada)
> Este documento es la referencia contra la que se verifica todo el trabajo.
> Está protegido por un control determinista (`.claude/hooks/guard-protected.sh`).
> Modificarlo exige `VERBO_SPEC_UNLOCK=1` y queda registrado en el event log.

## 1. Objetivo

Verbo es un mundo 3D en el navegador que el usuario **amplía hablándole**. Al pedir
una capacidad nueva ("que llueva"), un sistema de agentes genera código, lo verifica
en aislamiento, y lo **inyecta en caliente** en el mundo que el usuario está usando —
sin recarga, sin parpadeo y sin perder estado.

La tesis de ingeniería no es la generación. Es la **verificación**: qué hace falta para
que sea seguro inyectar código no escrito por humanos en un sistema en ejecución.

## 2. No-objetivos

Explícitos, para proteger el alcance:

- **NO** es un generador de mundos desde cero. Se parte de una escena base autoral.
- **NO** genera geometría ni assets. Compone primitivas tipadas ya existentes.
- **NO** persigue autonomía máxima. Persigue autonomía **verificable**.
- **NO** hay entrada por voz en v1 (sacrificada para invertir en cobertura de rúbrica).
- **NO** hay backend multiusuario. Persistencia = serialización del mundo a un enlace.

## 3. Restricciones

### Verificadas contra la literatura y la documentación

| ID | Restricción | Origen |
|----|-------------|--------|
| R-1 | El estado del arte genera mundos Three.js **behavioralmente correctos ~28% de las veces** (mejor modelo 27,8% V-Cov; ninguno >30%) | WorldCoder-Bench |
| R-2 | La evaluación **visual externa está descorrelacionada** con la corrección real (τb = −0,02) y un crítico agéntico aprueba el **45,6% de salidas gravemente defectuosas** | WorldCoder-Bench |
| R-3 | En headless, la presentación del canvas WebGPU **no llega al compositor** en Windows/Linux. Obliga a textura offscreen + `copyTextureToBuffer` + `mapAsync` | WebGPU headless |
| R-4 | Los módulos importados vía blob URL **no se pueden liberar de memoria**: la caché de namespaces no se puede limpiar | ES modules |
| R-5 | `WebGPURenderer` requiere `await renderer.init()` o el primer frame sale negro | Three.js r182 |
| R-6 | `timestamp-query` está cuantizado a 100 µs por defecto | WebGPU |
| R-7 | Latencia de un crítico visual multimodal: 4–16 s según modelo | Benchmarks 2026 |

### De producto

| ID | Restricción |
|----|-------------|
| R-8 | Presupuesto extremo a extremo: **≤ 40 s** desde intención hasta inyección |
| R-9 | El mundo del usuario **nunca** pierde estado, se pone negro ni baja de 30 fps por una inyección |
| R-10 | Debe correr en la máquina de un juez con un comando y sin claves propias (modo BYOK) |

## 4. Arquitectura

### 4.1 Las cuatro capas de verificación

Cada candidato se ejecuta en un **Web Worker con `OffscreenCanvas`** — aislado, sin DOM,
matable por timeout — y atraviesa cuatro oráculos en cascada con cortocircuito:

| Capa | Qué comprueba | Coste | Naturaleza |
|------|---------------|-------|------------|
| **L0 estático** | Compila (TSL→WGSL), solo toca su ámbito declarado, no usa APIs prohibidas | ~5 ms | Determinista |
| **L1 runtime** | `init()` resuelto, sin excepción en 120 frames, frame time ≤ 16 ms, draw calls y memoria en presupuesto | ~200 ms | Determinista |
| **L2 contrato de estado** | Aserciones sobre `window.__VERBO_STATE__` con snapshots antes/después de acciones guionizadas | ~1 s | **Oráculo principal** |
| **L3 perceptual** | Diff de píxeles (¿cambió algo?) + crítico visual multimodal | ~5 s | **Juez de gusto, no de verdad** |

### 4.2 Decisión central

**L2 es el oráculo de corrección. L3 no.** R-2 mide que la evaluación visual aprueba
casi la mitad de lo defectuoso. Un sistema que ponga el modelo de visión en el centro
está construido sobre un oráculo que la literatura ya midió como insuficiente.

### 4.3 Contratos endurecidos por mutación

Un contrato de estado no se acepta por fe. Se inyectan defectos deliberados en el
candidato (borrar la actualización de estado, corromper una constante, desconectar un
manejador) y **si el contrato no los detecta, el contrato no vale y se regenera**.

### 4.4 Biblioteca de primitivas

Por R-1, el agente **no inventa**: compone y parametriza primitivas tipadas del mundo
(emisores, materiales, campos de fuerza, luces, moduladores), cada una con `dispose()`
obligatorio (R-4) y su porción declarada de `__VERBO_STATE__`.

## 5. Decisiones mayores

| # | Decisión | Alternativa descartada | Razón |
|---|----------|------------------------|-------|
| D-1 | Contrato de estado como oráculo principal | Crítico visual como oráculo principal | R-2: aprueba 45,6% de lo roto |
| D-2 | Biblioteca de primitivas componibles | Generación libre de Three.js | R-1: 28% de acierto es inviable en vivo |
| D-3 | Worker + OffscreenCanvas para candidatos | `try/catch` en el hilo principal | Un bucle infinito no se atrapa; el worker se mata |
| D-4 | Render a textura offscreen + readback | Captura del canvas | R-3: única vía determinista multiplataforma |
| D-5 | 3 candidatos en paralelo, gana el primero válido | Un candidato con reintentos en serie | R-8: la latencia es requisito de producto |
| D-6 | Presupuesto acotado de inyecciones por sesión | Inyecciones ilimitadas | R-4: la fuga de memoria es estructural, se acota |
| D-7 | TSL en vez de WGSL/GLSL a mano | Shaders nativos | Un solo código, compila a ambos; el fallback sale gratis |
| D-8 | Sin voz en v1 | Voz como diferenciador | 12 h rinden más en cobertura de rúbrica |

## 6. Criterios de aceptación

Cada AC es verificable por máquina. Un AC sin verificación que pase **falla el build**.

### Núcleo de render
- **AC-01** La escena base carga con `await renderer.init()` resuelto y el primer frame no es negro.
- **AC-02** La escena base mantiene ≥ 55 fps medianos durante 10 s en hardware de referencia.
- **AC-03** Con WebGPU deshabilitado, cae a WebGL2 y AC-01 sigue cumpliéndose.

### Harness
- **AC-04** L0 rechaza un módulo que no compila, en < 50 ms.
- **AC-05** L0 rechaza un módulo que escribe fuera de su ámbito declarado.
- **AC-06** L1 rechaza un módulo cuyo frame time supera 16 ms.
- **AC-07** L1 rechaza un módulo que produce frame negro.
- **AC-08** L1 mata por timeout un candidato con bucle infinito, sin afectar al hilo principal.
- **AC-09** L2 rechaza un candidato que no satisface su contrato de estado.
- **AC-10** Un contrato que no detecta sus tres mutantes hermanos es descartado y regenerado.
- **AC-11** L3 nunca puede aprobar por sí solo: un candidato que falla L2 no se inyecta aunque L3 lo apruebe.

### Runtime e inyección
- **AC-12** Tras una inyección, el estado de usuario previo (cámara, entradas, objetos creados) es idéntico.
- **AC-13** Una inyección que lanza excepción en los primeros 3 s revierte automáticamente y el mundo queda como antes.
- **AC-14** El mundo nunca renderiza un frame negro durante una inyección.
- **AC-15** Tras 20 inyecciones consecutivas, la memoria no supera el presupuesto declarado.

### Intención
- **AC-16** Toda intención produce un par (código, contrato); nunca código sin contrato.
- **AC-17** Una intención imposible produce rechazo explicado, no un intento silencioso.

### Extremo a extremo
- **AC-18** "Que llueva" completa el ciclo en ≤ 40 s en el percentil 50.
- **AC-19** Con los tres candidatos fallando, el sistema reintenta ≤ 3 veces y luego informa; nunca cuelga.
- **AC-20** El mundo se serializa a un enlace y se restaura con los mismos verbos aplicados.

## 7. Definición de hecho

1. Los 20 AC tienen verificación automática que pasa.
2. El harness gobierna el desarrollo: ningún commit entra sin atravesarlo.
3. La eval nocturna acumula ≥ 5 noches y publica tasa de éxito **y de fallo**.
4. Un tercero clona, ejecuta un comando y ve el mundo, con su propia clave.
5. `SYSTEM.md` y `AI-DEV-LOG.md` se generan del event log.
