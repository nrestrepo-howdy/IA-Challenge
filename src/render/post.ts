/**
 * The cinematic pass: everything that happens after the geometry.
 *
 * The scene was authored as flat-shaded boxes and looked like it. Geometry was never
 * the problem — a night city is *made* of boxes. What was missing is the part of the
 * image that is not geometry at all: light that bleeds out of its source, a filmic
 * curve on the highlights, a frame that falls off at the corners, and enough grain to
 * stop large flat gradients banding into visible steps.
 *
 * The chain, in the order the pixels travel it:
 *
 *   scene ──▶ bloom (linear HDR) ──▶ tone map + colour space ──▶ vignette ──▶ grain
 *
 * The split at `renderOutput()` is the load-bearing decision. Bloom must run *before*
 * the tone curve, on values that are still allowed to exceed 1, or there is nothing
 * left above the threshold to bleed — the moon and the lit windows are authored above
 * 1 in `scene.ts` for exactly this reason. Vignette and grain must run *after* it, in
 * display space, because a vignette applied to linear values is a different (and
 * much heavier-handed) curve, and grain that is tone-mapped afterwards disappears
 * entirely from the highlights it is supposed to be sitting on.
 *
 * ## Degrading rather than crashing (AC-03)
 *
 * `?forceWebGL` must still work. `WebGPURenderer` runs the node system on both
 * backends, so this chain compiles on WebGL2 too — but WebGL2 has hard uniform-block
 * limits the WebGPU backend does not, and a post chain that throws inside the frame
 * loop would take the whole world with it. So construction and the first frame are
 * guarded, and any failure latches this pass into a direct `renderer.render()` for
 * the rest of the session. A world with no bloom is a worse picture; a world with a
 * dead render loop is no picture at all.
 */
import { PostProcessing } from 'three/webgpu';
import type { PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import {
  float, interleavedGradientNoise, luminance, pass, renderOutput, screenCoordinate, screenUV,
  smoothstep, time, vec2,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/** What `main.ts` calls once per frame in place of `renderer.render()`. */
export interface FramePass {
  render(): void;
  dispose(): void;
}

/**
 * Bloom, tuned for a scene whose subject is its own light sources.
 *
 * `THRESHOLD` sits above the daylight sky (whose brightest authored channel is 0.97)
 * and below the emissive sources, so noon does not turn into a white haze while the
 * moon, the windows, the aurora and the searchlight lamps all still bleed. Moving it
 * down is the fastest way to make every screenshot look like a soft-focus lens.
 */
// Tuned against dense fog, not against the empty night.
//
// At 0.7/0.85 the baseline looked right and "make this look like Blade Runner" -- fog
// at 0.06 plus heavy rain -- blew the whole frame to white. Fog is a large, uniformly
// bright surface, so a threshold low enough to catch rain highlights catches all of it
// and then the strength multiplies it. Raising the threshold keeps the bloom on things
// that are authored bright (moon, windows, searchlight cones) and off things that are
// merely pale.
const STRENGTH = 0.42;
const RADIUS = 0.8;
const THRESHOLD = 1.05;

/** How far the corners fall off. Measured against the *unit* corner distance, not px. */
const VIGNETTE_STRENGTH = 0.42;

/**
 * Grain amplitude in display space, 0..1.
 *
 * Deliberately at the edge of perception. This is doing two jobs: the visible one is
 * texture, and the invisible one is dithering the enormous smooth sky gradient, which
 * banded into visible steps at 8-bit output before it was here.
 */
const GRAIN = 0.022;

export function createFramePass(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
): FramePass {
  const direct = (): void => { renderer.render(scene, camera); };

  let post: PostProcessing;
  try {
    post = new PostProcessing(renderer);
    const scenePass = pass(scene, camera);
    const lit = scenePass.add(bloom(scenePass, STRENGTH, RADIUS, THRESHOLD));

    // The tone curve and the working->output colour conversion, applied here rather
    // than by the pipeline's own trailing transform, so that the two display-space
    // effects below can sit after it. `renderOutput` reads `renderer.toneMapping` and
    // `toneMappingExposure`, which is where the exposure knob lives (see renderer.ts).
    const graded = renderOutput(lit);

    // Radial falloff from the centre of frame. `screenUV` is aspect-unaware, so the
    // distance is scaled back to a circle first — otherwise a wide window darkens its
    // left and right edges far harder than its top and bottom, which reads as a lens
    // defect rather than as framing.
    const centred = screenUV.sub(0.5).mul(vec2(1.0, 0.62));
    const vignette = float(1).sub(centred.dot(centred).mul(VIGNETTE_STRENGTH * 4));

    const framed = graded.mul(vignette);

    // Per-pixel, per-frame. The jitter is what makes it grain rather than a fixed
    // dirt layer: `interleavedGradientNoise` is deterministic in screen space, so
    // without it the same speckle pattern would be welded to the display.
    //
    // Faded out in the deep shadows rather than applied flat. Grain sitting on a
    // crushed black is sensor noise, not film, and this world is mostly crushed black
    // by design — a flat ±GRAIN lifted the city's silhouettes off the floor, which is
    // both the wrong look and measurable: `structures.spec.ts` counts silhouette
    // pixels below a near-black threshold to prove a structural verb changed the
    // picture, and a grain that raises every black above that threshold quietly
    // destroys the evidence.
    const jitter = vec2(time.mul(37.13).sin(), time.mul(53.71).cos()).mul(311.7);
    const grain = interleavedGradientNoise(screenCoordinate.add(jitter))
      .sub(0.5)
      .mul(GRAIN)
      .mul(smoothstep(0.0, 0.22, luminance(framed.rgb)));

    post.outputColorTransform = false;
    post.outputNode = framed.add(grain);
  } catch (err) {
    // Node-graph construction is where a backend-specific limit shows up first.
    console.warn('post-processing unavailable, rendering direct:', err);
    return { render: direct, dispose: () => {} };
  }

  let live = true;
  return {
    render() {
      if (!live) { direct(); return; }
      try {
        post.render();
      } catch (err) {
        // Latched, not retried: a chain that failed to compile fails identically on
        // every subsequent frame, and one console line per frame at 60 Hz is its own
        // outage.
        console.warn('post-processing failed, falling back to direct render:', err);
        live = false;
        direct();
      }
    },
    dispose() {
      live = false;
      post.dispose();
    },
  };
}
