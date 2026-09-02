/**
 * State -> visual bindings.
 *
 * This module is the only place in the project that knows both about world state and
 * about Three.js, and it exists so that everything else can stay renderer-agnostic.
 * Primitives compute state; bindings draw it. That separation is what lets the layer
 * deciding correctness (L2, over state) run in plain Node with no GPU.
 *
 * A binding is chosen by the primitive's name, and it reads only from the state slice
 * at its `statePath`. It never reads the primitive instance -- so a binding cannot
 * accidentally observe something a contract does not cover, which would let a world
 * look right while its contract passed for the wrong reason.
 */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Fog, Points,
  PointsMaterial, Scene, Vector3,
} from 'three/webgpu';

export interface Binding {
  readonly statePath: string;
  /** Called each frame with the live slice at `statePath`. */
  update(slice: Record<string, unknown>, dt: number): void;
  dispose(): void;
}

export type BindingFactory = (scene: Scene, statePath: string) => Binding;

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * Falling particles. Positions are derived from state rather than stored in the
 * binding: `headY` is the authoritative value the contract asserts over, so drawing
 * from anything else would let the picture and the contract disagree.
 */
export const rainBinding: BindingFactory = (scene, statePath) => {
  const MAX = 20000;
  const geometry = new BufferGeometry();
  const positions = new Float32Array(MAX * 3);
  const seeds = new Float32Array(MAX);
  for (let i = 0; i < MAX; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 900;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 900;
    seeds[i] = Math.random();
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    size: 1.6, color: new Color(0.62, 0.72, 0.85),
    transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  return {
    statePath,
    update(slice) {
      const count = Math.min(MAX, Math.max(0, Math.floor(num(slice['particles'], 0))));
      const headY = num(slice['headY'], 300);
      const spread = num(slice['fallHeight'], 320);
      geometry.setDrawRange(0, count);
      const attr = geometry.getAttribute('position') as BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < count; i++) {
        // Each drop is the head offset by its own seeded fraction of the column, so
        // one authoritative value animates the whole field.
        arr[i * 3 + 1] = ((headY - seeds[i]! * spread) % spread + spread) % spread;
      }
      attr.needsUpdate = true;
      material.opacity = 0.25 + 0.4 * Math.min(1, count / 8000);
    },
    dispose() {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
    },
  };
};

export const fogBinding: BindingFactory = (scene, statePath) => {
  const previous = scene.fog;
  return {
    statePath,
    update(slice) {
      const density = num(slice['density'], 0);
      const colour = Array.isArray(slice['colour']) ? (slice['colour'] as number[]) : [0.05, 0.07, 0.1];
      const near = 40;
      const far = 40 + 1400 * (1 - Math.min(0.95, density));
      scene.fog = new Fog(new Color(colour[0] ?? 0, colour[1] ?? 0, colour[2] ?? 0), near, far);
    },
    dispose() { scene.fog = previous; },
  };
};

export const windBinding: BindingFactory = (scene, statePath) => {
  const direction = new Vector3();
  return {
    statePath,
    update(slice) {
      const v = Array.isArray(slice['vector']) ? (slice['vector'] as number[]) : [0, 0, 0];
      direction.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
      // Wind is felt through what it moves, not drawn directly. Rain reads it via
      // its own state, so there is nothing to render here -- the binding exists so
      // an unbound primitive is an explicit choice rather than an omission.
    },
    dispose() {},
  };
};

/** Primitive name -> how it is drawn. A name with no binding is state without a picture. */
export const BINDINGS: Readonly<Record<string, BindingFactory>> = {
  'rain-emitter': rainBinding,
  'snow-emitter': rainBinding,
  'fog-volume': fogBinding,
  'wind-field': windBinding,
};
