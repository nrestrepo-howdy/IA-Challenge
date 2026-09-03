/**
 * Entry point: wires the world, the bindings and the renderer into one loop.
 *
 * The seam that matters is that the world does not know this file exists. It computes
 * state; bindings read state and draw. Everything upstream -- primitives, contracts,
 * the L2 oracle -- stays renderer-agnostic and therefore testable without a GPU.
 */
import { World } from '../core/world.js';
import { createPrimitives } from '../world/index.js';
import { createRenderer } from '../render/renderer.js';
import { createBaseScene } from '../render/scene.js';
import { BINDINGS, type Binding } from '../render/bindings.js';
import { readPath } from '../harness/l2-contract.js';
import { CatalogueIntentCompiler, isRejection } from '../intent/compiler.js';
import { BrowserModuleLoader } from '../runtime/browser-loader.js';
import { runCycle, prober, type CycleStep } from './cycle.js';
import { encodeWorld, decodeWorld } from './share.js';
import { VerificationPanel } from './verification-panel.js';

/** What one utterance produced. Shaped for the nightly evaluation, not for the UI. */
export interface SayResult {
  readonly ok: boolean;
  readonly ms: number;
  readonly rejectedAt: string | null;
  /** What the catalogue could not express. Empty on a fully satisfied request. */
  readonly unaddressed?: readonly string[];
  readonly steps: readonly { kind: string; text: string }[];
  readonly reason: string | null;
}

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const status = document.getElementById('status') as HTMLElement;

const world = new World();
const base = createBaseScene();
const primitives = createPrimitives();
const bindings = new Map<string, Binding>();

const handle = await createRenderer(canvas);
status.textContent = `${handle.backend} · ready`;
document.body.dataset['backend'] = handle.backend;

function fit(): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  handle.renderer.setSize(w, h, false);
  base.resize(w, h);
}
addEventListener('resize', fit);
fit();

/**
 * Bindings are created and destroyed by watching state, not by being told. An injected
 * primitive appears in the world's state and a picture follows; unregistering removes
 * the slice and the picture goes with it. Nothing has to remember to keep them in step.
 */
function reconcile(): void {
  // `primitives` is a ReadonlyMap. An earlier version iterated it with
  // Object.values(), which returns [] for a Map -- so this loop ran zero times and
  // no binding was ever created, silently and without a type error.
  for (const p of primitives.values()) {
    const live = readPath(world.state, p.statePath) !== undefined;
    const bound = bindings.has(p.statePath);
    if (live && !bound) {
      const make = BINDINGS[p.name];
      if (make) bindings.set(p.statePath, make(base.scene, p.statePath));
    } else if (!live && bound) {
      bindings.get(p.statePath)!.dispose();
      bindings.delete(p.statePath);
    }
  }
}

/**
 * Frame capture, performed inside the loop immediately after `render()`.
 *
 * Reading the canvas from outside the loop returns an empty buffer: presentation does
 * not survive the frame, and in headless it never reaches the compositor at all (R-3).
 * So capture happens where the pixels exist. This is also the exact mechanism the L3
 * shadow renderer needs, which is why it lives here rather than in the test.
 */
const pending: ((d: ImageData) => void)[] = [];
let scratch: HTMLCanvasElement | null = null;

function capture(): Promise<ImageData> {
  return new Promise((resolve) => pending.push(resolve));
}

function drain(): void {
  if (pending.length === 0) return;
  scratch ??= document.createElement('canvas');
  const w = 160, h = 90;
  scratch.width = w; scratch.height = h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  for (const resolve of pending.splice(0)) resolve(data);
}

let last = performance.now();
handle.renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  world.tick(dt);
  reconcile();
  for (const [path, b] of bindings) {
    const slice = readPath(world.state, path);
    if (slice && typeof slice === 'object') b.update(slice as Record<string, unknown>, dt);
  }
  base.update(world.clock.elapsed);
  handle.renderer.render(base.scene, base.camera);
  drain();
});

// Exposed for the browser-level acceptance tests (AC-01..03) and for the harness's
// state snapshots. The name matches what StateContracts address.
// The shim modules a candidate imports read the registry from here: a blob module
// cannot capture a reference from the page that created it.
const compiler = new CatalogueIntentCompiler();
const loader = new BrowserModuleLoader(primitives as never);  // publishes __VERBO_PRIMITIVES__
const input = document.getElementById('say') as HTMLInputElement;
const log = document.getElementById('log') as HTMLElement;
const panel = new VerificationPanel(document.getElementById('verify') as HTMLElement);

function line(text: string, kind: CycleStep['kind'] | 'you'): void {
  const el = document.createElement('div');
  el.className = `l ${kind}`;
  el.textContent = text;
  log.prepend(el);
  while (log.childElementCount > 9) log.lastElementChild?.remove();
}

let busy = false;

/**
 * One verb, start to finish. Exposed so the acceptance suite drives the same path a
 * person does -- a test that calls a private seam proves the seam works, not the
 * product (AC-18).
 */
async function say(utterance: string): Promise<SayResult> {
  if (busy) return { ok: false, ms: 0, rejectedAt: null, steps: [], reason: 'busy' };
  busy = true;
  input.disabled = true;
  line(utterance, 'you');
  panel.begin(utterance);
  try {
    const compiled = await compiler.compile(utterance, world);
    if (isRejection(compiled)) {
      // AC-17: an impossible request is explained, never silently attempted.
      line(compiled.suggestion ? `${compiled.reason} — ${compiled.suggestion}` : compiled.reason, 'reject');
      return { ok: false, ms: 0, rejectedAt: 'intent', steps: [], reason: compiled.reason };
    }
    if (compiled.unaddressed.length) {
      // Accepted, and said out loud. Delivering a subset in silence is the failure
      // the rules name; delivering it with the gap stated is honest service.
      line(`cannot express: ${compiled.unaddressed.map((u) => `"${u}"`).join(', ')}`, 'reject');
    }
    const outcome = await runCycle(compiled, loader, world, (s) => {
      panel.step(s);
      // Generation notices belong in the panel's lanes, not duplicated in the log.
      if (!(s.candidate && s.kind === 'info')) line(s.text, s.kind);
    });
    panel.end();
    line(outcome.ok ? `done in ${(outcome.ms / 1000).toFixed(1)}s` : (outcome.reason ?? 'failed'),
      outcome.ok ? 'accept' : 'reject');
    if (outcome.ok) {
      // The link carries intent, never code. replaceState rather than push: the world
      // is cumulative, so each verb refines one address instead of stacking history
      // entries a back button would have to unwind.
      const verbs = world.snapshot().verbs.map((v) => v.utterance);
      history.replaceState(null, '', `#${encodeWorld(verbs)}`);
    }
    // The full shape is returned, not just ok/ms, because the nightly evaluation
    // needs to know *which layer* rejected. An aggregate pass rate hides the thing
    // worth knowing: whether failures are concentrated somewhere fixable.
    return {
      ok: outcome.ok,
      ms: outcome.ms,
      rejectedAt: outcome.ok ? null : (outcome.verdicts.at(-1)?.failedAt ?? 'unknown'),
      unaddressed: compiled.unaddressed,
      steps: outcome.steps.map((s) => ({ kind: s.kind, text: s.text })),
      reason: outcome.reason,
    };
  } finally {
    busy = false;
    input.disabled = false;
    input.value = '';
    input.focus();
  }
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && input.value.trim()) void say(input.value.trim());
});

/**
 * Replaying a shared link.
 *
 * The verbs run through the same pipeline that built them originally, so a shared
 * world is re-verified on arrival rather than trusted: if a primitive has changed, the
 * oracles judge the new result on its own merits and a verb that no longer satisfies
 * its contract simply does not appear. The honest cost is that a replayed world is not
 * guaranteed pixel-identical to the original, only contract-identical.
 */
async function replayFromLink(): Promise<void> {
  const verbs = decodeWorld(location.hash);
  if (verbs.length === 0) return;
  line(`restoring ${verbs.length} verb${verbs.length === 1 ? '' : 's'} from a shared world`, 'info');
  for (const v of verbs) await say(v);
}

status.addEventListener('click', () => {
  void navigator.clipboard?.writeText(location.href).then(() => {
    const was = status.textContent;
    status.textContent = 'link copied';
    setTimeout(() => { status.textContent = was; }, 1400);
  });
});

Object.assign(globalThis, {
  __VERBO_STATE__: world.state,
  __VERBO__: { world, primitives, handle, capture, say, loader, replayFromLink, prober },
});

await replayFromLink();
