/**
 * WebGPU renderer bootstrap.
 *
 * Two things here are not incidental:
 *
 *   1. `await renderer.init()` before the first frame. Skipping it ships a black
 *      first frame (R-5) -- the exact condition L1 rejects candidates for, so the
 *      base scene had better not do it either.
 *   2. `three/webgpu` falls back to WebGL2 on its own when WebGPU is unavailable
 *      (AC-03). We report which backend won rather than assuming, because a silent
 *      fallback that halves the frame rate would otherwise surface as a mysterious
 *      L1 budget failure.
 */
import {
  VSMShadowMap, ACESFilmicToneMapping, WebGPURenderer } from 'three/webgpu';

export interface RendererHandle {
  readonly renderer: WebGPURenderer;
  readonly backend: 'webgpu' | 'webgl2';
  dispose(): void;
}

export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererHandle> {
  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL: forcedToWebGL() });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));

  // The scene renders with no tone curve at all until this is set, which is why the
  // moon clipped to a flat white disc and every mid-tone sat in the same two stops.
  //
  // ACES over AgX, decided by shooting both. AgX and ACES are near-identical at noon,
  // but AgX lifts the night: the near-black building faces come up to the same grey as
  // the sky behind them and the silhouettes the whole scene is built on stop reading.
  // A world that is at midnight by default cannot afford a curve that flattens
  // midnight.
  //
  // Exposure above 1 because ACES pulls mid-tones down and the authored night is
  // already dark; 1.45 was picked by shooting dawn, noon, dusk and midnight and taking
  // the value where midnight has separation and noon still has sky above the buildings
  // rather than a white ceiling. `post.ts` reads both of these through `renderOutput()`.
  /**
   * Shadows, which is the single largest reason this city read as unreal.
   *
   * There were none. A bright moon over eighteen hundred volumes and not one of them
   * cast anything, so every building met the ground at a hard edge with no contact
   * darkening and no silhouette thrown across its neighbour. Nothing else on the list —
   * materials, post, texture detail — competes with that: an eye reads a missing shadow
   * before it reads anything else, and no amount of grading covers for it.
   *
   * `VSM` rather than PCF: the moon is a large, soft source and the city is mostly long
   * straight edges, where PCF's fixed kernel gives a hard stair-stepped line. VSM blurs
   * in shadow space, which is what a soft source actually does.
   */
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = VSMShadowMap;

  renderer.toneMapping = ACESFilmicToneMapping;
  // 1.45 lifted the authored night nicely and over-exposed anything with fog in it.
  // The night is dark by design and bloom now does the lifting, so exposure only has
  // to stop ACES crushing the mid-tones.
  renderer.toneMappingExposure = 1.15;
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  // R-5. Nothing may render before this resolves.
  await renderer.init();

  // `isWebGPUBackend` is set by the backend implementation but is not on the
  // published `Backend` type, so the check is structural. Reading it wrongly would
  // only mislabel a report; guessing instead would hide a silent fallback.
  const backend: RendererHandle['backend'] =
    (renderer.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend
      ? 'webgpu' : 'webgl2';
  return {
    renderer,
    backend,
    dispose: () => renderer.dispose(),
  };
}

/**
 * `?forceWebGL` exists so AC-03 can be verified in a browser that does support
 * WebGPU. A fallback path nobody can reach on demand is a fallback path nobody
 * has tested.
 *
 * `VITE_FORCE_WEBGL=1` forces the same thing at build time, and exists for one reason:
 * a headless CI runner has no GPU, so its WebGPU is SwiftShader, which initialises and
 * then drops the device part-way through a run — twenty-four "Instance dropped in
 * popErrorScope" errors, after which every frame capture waits on a device that is
 * gone and eighteen of twenty-six browser tests time out. The suite is not there to
 * test SwiftShader. It is there to test the product, and WebGL2 is a backend the
 * product ships.
 *
 * The honest cost, stated rather than buried: under this flag the AC-03 test reaches
 * WebGL2 from a browser that was already on WebGL2, so it stops proving a *fallback*.
 * That claim is verified where it means something — on a machine that actually has
 * WebGPU to fall back from. The deploy job builds without the flag, so what is
 * published still prefers WebGPU.
 */
function forcedToWebGL(): boolean {
  const build = (import.meta as { env?: Record<string, string | undefined> }).env;
  if (build?.['VITE_FORCE_WEBGL'] === '1') return true;
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).has('forceWebGL');
}
