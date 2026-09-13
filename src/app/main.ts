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
import { createFramePass } from '../render/post.js';
import { createBaseScene } from '../render/scene.js';
import { BINDINGS, type Binding } from '../render/bindings.js';
import { readPath } from '../harness/l2-contract.js';
import { CatalogueIntentCompiler, isRejection } from '../intent/compiler.js';
import { keywordModel, type LanguageModel } from '../intent/model.js';
import { lastResolver, ProxiedModel, withFallback } from './proxied-model.js';
import { browserModel, forgetKey, looksLikeKey, storeKey, storedKey } from './byok.js';
import { ProxiedVisualCritic } from './proxied-critic.js';
import { ProxiedFigureAuthor } from './proxied-figure.js';
import { BrowserModuleLoader } from '../runtime/browser-loader.js';
import { runCycle, prober, type CycleStep } from './cycle.js';
import { encodeWorld, decodeWorld } from './share.js';
import { VerificationPanel } from './verification-panel.js';
import { WorldHistory } from './history.js';
import { Inventory } from './inventory.js';
import { SuggestionRow, deriveSuggestions } from './suggestions.js';

/** What one utterance produced. Shaped for the nightly evaluation, not for the UI. */
export interface SayResult {
  readonly ok: boolean;
  readonly ms: number;
  readonly rejectedAt: string | null;
  /** What the catalogue could not express. Empty on a fully satisfied request. */
  readonly unaddressed?: readonly string[];
  readonly steps: readonly { kind: string; text: string }[];
  readonly reason: string | null;
  /** Which resolver answered: the model, or the built-in phrasebook floor. */
  readonly resolver?: 'model' | 'phrasebook';
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

/**
 * The frame goes through a post chain rather than straight to the canvas: tone mapping,
 * bloom, vignette and grain are what separate this world from a screenshot of a
 * Three.js tutorial. The pass owns the render call so this file does not have to know
 * whether the chain compiled on this backend (AC-03) — it degrades to a direct render.
 */
const frame = createFramePass(handle.renderer, base.scene, base.camera);

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
  // 512x288, not 160x90. The small frame was sized for the L1 before/after difference,
  // which only needs enough pixels to tell "something changed" from "nothing did". L3
  // is asked whether a frame reads as a storm at night, and a thumbnail two fingers
  // wide cannot answer that — rain becomes noise and a skyline becomes a smudge.
  const w = 512, h = 288;
  scratch.width = w; scratch.height = h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  for (const resolve of pending.splice(0)) resolve(data);
}

/**
 * Frames survived since a primitive last threw, and whether we have already said so.
 *
 * `World.tick()` re-throws the first error once the frame is complete so an injector
 * can roll back (AC-13) — but this app has no injector in the loop, and three's
 * WebGL2 animation driver re-arms `requestAnimationFrame` *after* calling back
 * (`WebGLAnimation.onAnimationFrame`), so one throw from one injected primitive ended
 * the render loop permanently: a frozen world, no recovery, R-9 violated by a single
 * bad update. The WebGPU driver re-arms first and would have survived, which is why
 * this never showed up — the failure only exists on the fallback path AC-03 covers.
 *
 * So the throw is caught and the frame carries on. The offender keeps its slice and
 * keeps throwing, so after a few frames the last verb is undone, which disposes it.
 */
let tickFailures = 0;
let recovering = false;

function tick(dt: number): void {
  try {
    world.tick(dt);
    tickFailures = 0;
  } catch (err) {
    // Three strikes rather than one: a primitive that throws on the frame it mounts
    // and then settles is not worth tearing the world down for.
    if (tickFailures === 0) line(`a primitive threw during the frame: ${String(err)}`, 'reject');
    if (++tickFailures >= 3 && !recovering && worldHistory.depth > 0) {
      recovering = true;
      line('undoing the last verb: it throws every frame', 'reject');
      // `World.tick` re-throws the first error but not the identity of whoever raised
      // it, so the last verb is the best available guess at the offender. Naming the
      // faulting instance would be a `contracts.ts` change, and is reported, not made.
      void undo().finally(() => { recovering = false; tickFailures = 0; });
    }
  }
}

let last = performance.now();
handle.renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  tick(dt);
  reconcile();
  for (const [path, b] of bindings) {
    const slice = readPath(world.state, path);
    if (slice && typeof slice === 'object') b.update(slice as Record<string, unknown>, dt);
  }
  // Framing follows the world's own published state, not a flag the cycle sets: a
  // primitive that grows the city does not have to know a camera exists.
  const skyline = readPath(world.state, 'structures.skyline.heightScale');
  const tower = readPath(world.state, 'structures.tower.height');
  base.setFraming(Math.max(
    typeof skyline === 'number' ? (skyline - 1) / 4 : 0,
    typeof tower === 'number' ? tower / 900 : 0,
  ));
  base.update(world.clock.elapsed);
  frame.render();
  drain();
});

// Exposed for the browser-level acceptance tests (AC-01..03) and for the harness's
// state snapshots. The name matches what StateContracts address.
// The shim modules a candidate imports read the registry from here: a blob module
// cannot capture a reference from the page that created it.
/**
 * Resolution order: the server proxy, then a key the visitor supplied, then keywords.
 *
 * This line is the one that was missing for a week. `new CatalogueIntentCompiler()`
 * with no argument resolves with a keyword table — which is why the product understood
 * "make it rain" and rejected "make it cozy", and why nothing in the running app ever
 * called a model at all.
 *
 * The proxy is first because a key that never leaves a server is the better
 * arrangement, and it is what a local checkout gets. The browser key exists because
 * the published site is static and would otherwise demonstrate a phrasebook. Keywords
 * are the floor, and the product genuinely works on it — which is why falling back is
 * announced rather than silent.
 */
let announcedFallback = false;
const proxied = new ProxiedModel();

/**
 * L3's critic, and the reason it is constructed once rather than per verb.
 *
 * The layer has existed since day nine and had never judged a frame: the class was
 * written, tested against a stub, and never reachable from here. Every verb logged
 * "no visual critic configured, so appearance was not judged" — honest, and an
 * admission that a quarter of the harness was decorative.
 *
 * Still advisory. `isInjectable()` decides; this runs after the winner is mounted and
 * cannot veto (D-1, AC-11). A critic that throws or is unreachable produces a step
 * naming what went unjudged, never a pass.
 */
const critic = new ProxiedVisualCritic();

/** Writes a rig when the catalogue cannot. Unreachable without a server key, by design. */
const figureAuthor = new ProxiedFigureAuthor();

function resolver(): LanguageModel {
  const key = storedKey();
  const upstream: LanguageModel = key
    ? {
        async propose(request) {
          try {
            return await proxied.propose(request);
          } catch {
            return browserModel(key).propose(request);
          }
        },
      }
    : proxied;

  return withFallback(upstream, keywordModel, (reason) => {
    // Once per session. Someone who typed something a model would have understood
    // deserves to know the resolver is offline rather than concluding the world
    // cannot do it — but not on every verb.
    if (announcedFallback) return;
    announcedFallback = true;
    line(`resolver offline (${reason}) — using the built-in phrasebook`, 'reject');
  });
}
const loader = new BrowserModuleLoader(primitives as never);  // publishes __VERBO_PRIMITIVES__
const input = document.getElementById('say') as HTMLInputElement;
const log = document.getElementById('log') as HTMLElement;
const panel = new VerificationPanel(document.getElementById('verify') as HTMLElement);

/**
 * The world's chrome: what is in it, and the way back out.
 *
 * All three of these are driven from `world.snapshot()` rather than from anything this
 * file accumulates on the side. A second bookkeeping of what the world contains is a
 * second thing that can be wrong about it.
 */
const worldHistory = new WorldHistory(world, loader, () => sync());
const inventory = new Inventory(document.getElementById('inventory') as HTMLElement, {
  undo: () => { void undo(); },
  remove: (i) => { void dropVerb(i); },
});
const suggestions = new SuggestionRow(
  document.getElementById('suggest') as HTMLElement,
  (utterance) => { void say(utterance); },
);

/**
 * Re-points everything that describes the world after the world changes shape.
 *
 * `World.restore()` installs a fresh state tree, so the published reference has to be
 * re-pointed or the harness's snapshots would read a tree nothing writes to any more.
 * The link is rewritten here too, so it always addresses what is on screen — including
 * after an undo, where a link still naming the removed verb would be a link to a world
 * the user deliberately discarded.
 */
function sync(): void {
  Object.assign(globalThis, { __VERBO_STATE__: world.state });
  // The effective list, not the raw log: `World.recordVerb` appends, so saying "make
  // it rain" twice leaves two entries of which only the second owns anything. Listing
  // the dead one in the inventory offers a remove button for a verb that is not in the
  // world, and putting it in the link makes a visitor spend a cycle rebuilding it.
  const verbs = worldHistory.verbs;
  history.replaceState(null, '',
    verbs.length ? `#${encodeWorld(verbs.map((v) => v.utterance))}` : location.pathname + location.search);
  inventory.render(verbs, worldHistory.depth > 0);
  // The openers occupy the same band as the log, and they earn it only while there is
  // nothing else to read: once anything has been said, the transcript is the more
  // useful thing to have in that space.
  suggestions.setVisible(verbs.length === 0 && log.childElementCount === 0);
}

/**
 * How long a line stays before it fades.
 *
 * The transcript reports what is happening, not what happened: a log that accumulates
 * over a world is a debug console, and after five verbs it is a wall of text sitting
 * on the only thing worth looking at. Lines leave on their own, and when the last one
 * goes on an empty world the openers come back.
 */
const LINE_DWELL_MS = 14_000;

function line(text: string, kind: CycleStep['kind'] | 'you'): void {
  const el = document.createElement('div');
  el.className = `l ${kind}`;
  // One line each. A diagnosis is written for a repair agent and runs to several
  // sentences; printed in full it wraps across the world and buries the verb the user
  // just typed. The full text stays in the panel and in the cycle outcome.
  el.textContent = text.length > 96 ? text.slice(0, 95).trimEnd() + '…' : text;
  el.title = text;
  log.prepend(el);
  while (log.childElementCount > 5) log.lastElementChild?.remove();
  setTimeout(() => {
    el.classList.add('gone');
    // Removed on the transition rather than on a second timer: with reduced motion
    // the transition is instant, and a fixed delay would leave a hole in the column.
    const drop = (): void => {
      el.remove();
      if (log.childElementCount === 0) sync();
    };
    el.addEventListener('transitionend', drop, { once: true });
    setTimeout(drop, 900);
  }, LINE_DWELL_MS);
}

let busy = false;

/**
 * One verb, start to finish. Exposed so the acceptance suite drives the same path a
 * person does -- a test that calls a private seam proves the seam works, not the
 * product (AC-18).
 */
async function say(utterance: string): Promise<SayResult> {
  // Timed from the utterance, not from the cycle.
  //
  // `ms` used to carry `outcome.ms`, which starts after the resolver has answered —
  // so AC-18's 40 s budget (R-8) was measured against everything except the part that
  // could breach it. With the deterministic phrasebook the two numbers are the same
  // and nobody noticed; the first live model call read 108 ms for an 8.8 s request.
  //
  // A budget that excludes the slow half is not a budget.
  const startedAt = performance.now();
  if (busy) return { ok: false, ms: 0, rejectedAt: null, steps: [], reason: 'busy' };
  busy = true;
  input.disabled = true;
  line(utterance, 'you');
  panel.begin(utterance);
  suggestions.setVisible(false);
  try {
    // Taken before anything is injected, and kept only if something was: an undo step
    // for an utterance that changed nothing would be a lie about what the world holds.
    const before = world.snapshot();
    // Built per utterance so a key pasted mid-session takes effect on the next verb
    // rather than on the next reload.
    const compiled = await new CatalogueIntentCompiler({
      model: resolver(),
      // Always supplied; it is the endpoint that decides whether there is a key, and it
      // answers 503 with a reason when there is not. The compiler catches that and falls
      // back to the written rigs, so the freeform path degrades the same way everything
      // else here does — to something smaller that still works.
      figureAuthor: figureAuthor,
    }).compile(utterance, world);
    if (isRejection(compiled)) {
      // AC-17: an impossible request is explained, never silently attempted.
      const explanation = compiled.suggestion ? `${compiled.reason} — ${compiled.suggestion}` : compiled.reason;
      line(explanation, 'reject');
      // The panel was opened before the compile; saying nothing in it would leave a
      // started thing unfinished on screen.
      panel.dismiss(explanation);
      return {
        ok: false, ms: performance.now() - startedAt, rejectedAt: 'intent',
        steps: [], reason: compiled.reason, resolver: lastResolver(),
      };
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
    }, { critic });
    panel.end();
    line(outcome.ok ? `done in ${(outcome.ms / 1000).toFixed(1)}s` : (outcome.reason ?? 'failed'),
      outcome.ok ? 'accept' : 'reject');
    if (outcome.ok) {
      // The link carries intent, never code. replaceState rather than push: the world
      // is cumulative, so each verb refines one address instead of stacking history
      // entries a back button would have to unwind.
      worldHistory.push(before);
      sync();
    }
    // The full shape is returned, not just ok/ms, because the nightly evaluation
    // needs to know *which layer* rejected. An aggregate pass rate hides the thing
    // worth knowing: whether failures are concentrated somewhere fixable.
    return {
      ok: outcome.ok,
      ms: performance.now() - startedAt,
      rejectedAt: outcome.ok ? null : (outcome.verdicts.at(-1)?.failedAt ?? 'unknown'),
      unaddressed: compiled.unaddressed,
      steps: outcome.steps.map((s) => ({ kind: s.kind, text: s.text })),
      reason: outcome.reason,
      resolver: lastResolver(),
    };
  } finally {
    busy = false;
    input.disabled = false;
    input.value = '';
    input.focus();
  }
}

/**
 * The key affordance.
 *
 * Stated rather than hidden: a key in a browser is readable by anything else running
 * in that browser, and the local `npm run dev` path — where it stays on a server —
 * exists for anyone who would rather not. This is here so the published, static site
 * can demonstrate the system it describes instead of a phrasebook.
 */
const keyRow = document.getElementById('key') as HTMLElement;
const keyInput = document.getElementById('key-input') as HTMLInputElement;
const keyToggle = document.getElementById('key-toggle') as HTMLButtonElement;

function paintKeyState(): void {
  const live = storedKey() !== null;
  keyRow.dataset['live'] = String(live);
  keyToggle.textContent = live ? 'key active · forget' : 'use your own key';
}

keyToggle.addEventListener('click', () => {
  if (storedKey()) {
    forgetKey();
    keyRow.dataset['open'] = 'false';
    keyInput.value = '';
    paintKeyState();
    line('key forgotten — back to the built-in phrasebook', 'info');
    return;
  }
  const open = keyRow.dataset['open'] !== 'true';
  keyRow.dataset['open'] = String(open);
  if (open) keyInput.focus();
});

keyInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const value = keyInput.value.trim();
  if (!looksLikeKey(value)) {
    // Shape only. Whether it works is answered by the first call, not by a regex —
    // so this rejects an obvious paste error and never claims the key is good.
    line('that does not look like an Anthropic key (sk-ant-…)', 'reject');
    return;
  }
  storeKey(value);
  keyInput.value = '';
  keyRow.dataset['open'] = 'false';
  announcedFallback = false;   // a new key deserves a fresh chance to be announced
  paintKeyState();
  line('key stored for this tab — the resolver will use it on the next verb', 'accept');
});

paintKeyState();

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && input.value.trim()) void say(input.value.trim());
});

/**
 * Undo, and removing one verb from the middle.
 *
 * Both are refused while a cycle is running: the injector is mid-flight over the same
 * paths, and rebuilding the world underneath it would race a mount against a restore.
 */
async function undo(): Promise<boolean> {
  if (busy || worldHistory.depth === 0) return false;
  busy = true;
  try {
    const undone = await worldHistory.undo();
    if (undone) line('undone', 'info');
    return undone;
  } finally {
    busy = false;
  }
}

async function dropVerb(index: number): Promise<boolean> {
  if (busy) return false;
  const verb = worldHistory.verbs[index];
  busy = true;
  try {
    const removed = await worldHistory.remove(index);
    if (removed && verb) line(`removed “${verb.utterance}”`, 'info');
    return removed;
  } finally {
    busy = false;
  }
}

// The world is cumulative, so the one shortcut every user already knows is the one it
// most needs. Captured on the window rather than the input: the affordance belongs to
// the world, not to the text field that happens to have focus.
addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    void undo();
  }
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
  __VERBO__: {
    world, primitives, handle, capture, say, loader, replayFromLink, prober,
    undo, dropVerb, history: worldHistory, suggestions: deriveSuggestions(),
  },
});

// After the replay, never before it: `sync()` rewrites the hash, and an empty world
// rewrites it to nothing — which would erase the shared link before it was read.
await replayFromLink();
sync();
