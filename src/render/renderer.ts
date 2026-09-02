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
import { WebGPURenderer } from 'three/webgpu';

export interface RendererHandle {
  readonly renderer: WebGPURenderer;
  readonly backend: 'webgpu' | 'webgl2';
  dispose(): void;
}

export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererHandle> {
  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL: forcedToWebGL() });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
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
 */
function forcedToWebGL(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).has('forceWebGL');
}
