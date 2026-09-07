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
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, Fog,
  InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, MeshStandardMaterial,
  Points, PointsMaterial, Quaternion, Scene, Vector3,
} from 'three/webgpu';
import { sceneHandles } from './scene.js';

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
  const MAX = 14000;
  // Segments, not points. A falling drop is a streak; drawn as a dot it reads as
  // static noise, which is what the first screenshot showed and what no amount of
  // opacity tuning was going to fix.
  const geometry = new BufferGeometry();
  const positions = new Float32Array(MAX * 6);
  const seeds = new Float32Array(MAX);
  const lengths = new Float32Array(MAX);
  for (let i = 0; i < MAX; i++) {
    const x = (Math.random() - 0.5) * 1100;
    const z = (Math.random() - 0.5) * 1100;
    positions[i * 6] = x;
    positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x;
    positions[i * 6 + 5] = z;
    seeds[i] = Math.random();
    lengths[i] = 5 + Math.random() * 11;
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({
    color: new Color(0.66, 0.76, 0.94),
    transparent: true, opacity: 0.42, blending: AdditiveBlending, depthWrite: false,
  });
  const rain = new LineSegments(geometry, material);
  rain.frustumCulled = false;
  scene.add(rain);

  return {
    statePath,
    update(slice) {
      const count = Math.min(MAX, Math.max(0, Math.floor(num(slice['particles'], 0))));
      const headY = num(slice['headY'], 300);
      // `spread` is what the emitter publishes. This read said `fallHeight`, which no
      // primitive has ever written, so every drop fell through the fallback and the
      // `spread` parameter did nothing on screen — a binding reading a key that is not
      // there is exactly the silent no-op this layer exists to prevent.
      const spread = num(slice['spread'], 320);
      geometry.setDrawRange(0, count * 2);
      const attr = geometry.getAttribute('position') as BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < count; i++) {
        // One authoritative value — headY, the field the contract asserts over —
        // animates the whole field. Drawing from anything else would let the picture
        // and the contract disagree.
        const y = ((headY - seeds[i]! * spread) % spread + spread) % spread;
        arr[i * 6 + 1] = y + lengths[i]!;
        arr[i * 6 + 4] = y;
      }
      attr.needsUpdate = true;
      material.opacity = 0.2 + 0.32 * Math.min(1, count / 7000);
    },
    dispose() {
      scene.remove(rain);
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
      // The catalogue field is `color`; reading `colour` silently pinned every fog to
      // the fallback, so the colour parameter was never visible.
      const colour = Array.isArray(slice['color']) ? (slice['color'] as number[]) : [0.05, 0.07, 0.1];
      // Both ends move with density. Pinning `near` at 40 put the fog plane almost at
      // the camera even for a light haze, which reads as a washed lens rather than as
      // weather: the near field is where the world's contrast lives.
      const d = Math.min(0.95, density / 0.2);
      const near = 260 - 200 * d;
      const far = 1600 - 1200 * d;
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
      // `direction` is the declared field; `vector` never existed.
      const v = Array.isArray(slice['direction']) ? (slice['direction'] as number[]) : [0, 0, 0];
      direction.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
      // Wind is felt through what it moves, not drawn directly. Rain reads it via
      // its own state, so there is nothing to render here -- the binding exists so
      // an unbound primitive is an explicit choice rather than an omission.
    },
    dispose() {},
  };
};

// ─── structural bindings ─────────────────────────────────────────────────────
// The atmospheric bindings above all add something in front of the base scene. These
// three change the world's own substance, which is why two of them reach the authored
// geometry through `sceneHandles()` — and why both of those restore it in `dispose()`:
// R-4 makes the module leak structural, so putting the world back is the only cleanup
// there is, and a structural verb that could not be undone would leave the user's world
// permanently altered by a rolled-back injection (AC-12, AC-13).

/**
 * Towers, drawn from the heights the primitive is currently publishing.
 *
 * `grown` is the authoritative per-site height and the mesh is scaled straight from it,
 * so a tower that is half-risen in state is half-risen on screen. Deriving the height
 * from a local clock instead would let the picture and the contract disagree about a
 * value the contract is asserting over.
 */
export const towerBinding: BindingFactory = (scene, statePath) => {
  // The schema's maximum count. Allocated once: an InstancedMesh cannot grow, and
  // rebuilding one mid-verb is how an injection drops a frame (AC-14).
  const MAX = 8;
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshStandardMaterial({
    color: new Color(0.02, 0.026, 0.04), roughness: 0.7, metalness: 0.35,
  });
  const mesh = new InstancedMesh(geometry, material, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  // A warm crown on each tower. A near-black silhouette against a near-black skyline
  // is a shape nobody can find; the light on top is what says "this is new".
  const crownGeo = new BufferGeometry();
  crownGeo.setAttribute('position', new BufferAttribute(new Float32Array(MAX * 3), 3));
  const crownMat = new PointsMaterial({
    size: 9, color: new Color(1, 0.72, 0.42), transparent: true, opacity: 0.95,
    blending: AdditiveBlending, depthWrite: false,
  });
  const crowns = new Points(crownGeo, crownMat);
  crowns.frustumCulled = false;
  scene.add(crowns);

  const m = new Matrix4(), q = new Quaternion(), pos = new Vector3(), scl = new Vector3();
  const axisY = new Vector3(0, 1, 0);

  return {
    statePath,
    update(slice) {
      const sites = Array.isArray(slice['sites']) ? (slice['sites'] as unknown[]) : [];
      const grown = Array.isArray(slice['grown']) ? (slice['grown'] as unknown[]) : [];
      const count = Math.min(MAX, sites.length);
      const crownPos = (crownGeo.getAttribute('position') as BufferAttribute).array as Float32Array;

      for (let i = 0; i < count; i++) {
        const site = sites[i] as number[] | undefined;
        if (!site) continue;
        const [x = 0, z = 0, width = 1, depth = 1, , spin = 0] = site;
        // A zero-height instance still renders a degenerate quad, so the floor is a
        // sliver rather than nothing: the tower appears as a foundation and grows.
        const height = Math.max(0.5, num(grown[i], 0));
        pos.set(x, height / 2, z);
        scl.set(width, height, depth);
        q.setFromAxisAngle(axisY, spin);
        mesh.setMatrixAt(i, m.compose(pos, q, scl));
        crownPos[i * 3] = x;
        crownPos[i * 3 + 1] = height + 4;
        crownPos[i * 3 + 2] = z;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      crownGeo.setDrawRange(0, count);
      (crownGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      scene.remove(crowns);
      geometry.dispose();
      material.dispose();
      crownGeo.dispose();
      crownMat.dispose();
      mesh.dispose();
    },
  };
};

/**
 * The authored city, rescaled.
 *
 * The only binding that touches geometry it did not create, so it is also the only one
 * that has to be able to hand it back. `reset()` on dispose restores the authored
 * heights and count exactly — the handle keeps the authored values, so restoration does
 * not depend on this binding having remembered them correctly.
 */
export const skylineBinding: BindingFactory = (scene, statePath) => {
  const handles = sceneHandles(scene);
  const skyline = handles?.skyline ?? null;
  // Redrawing 520 instances every frame for a city that stopped moving two seconds ago
  // is budget spent against R-9 for no picture. The shift is eased, so "unchanged"
  // means unchanged to well below a pixel.
  let lastScale = Number.NaN;
  let lastVisible = -1;

  return {
    statePath,
    update(slice) {
      if (!skyline) return;
      const scale = num(slice['heightNow'], 1);
      const visible = Math.max(
        1,
        Math.min(skyline.maxCount, Math.round(skyline.baseCount * num(slice['densityNow'], 1))),
      );
      if (Math.abs(scale - lastScale) < 1e-4 && visible === lastVisible) return;
      lastScale = scale;
      lastVisible = visible;
      skyline.apply(scale, visible);
    },
    dispose() {
      skyline?.reset();
    },
  };
};

/**
 * What the world is made of.
 *
 * The cross-fade runs from the *authored* material rather than from the material's
 * current value, so the tint converges on the requested colour instead of chasing its
 * own previous frame, and `reset()` lands back exactly where the world started.
 */
export const groundBinding: BindingFactory = (scene, statePath) => {
  const handles = sceneHandles(scene);
  const ground = handles?.ground ?? null;
  const target = new Color();

  return {
    statePath,
    update(slice) {
      if (!ground) return;
      const c = Array.isArray(slice['color']) ? (slice['color'] as number[]) : null;
      if (!c) return;
      const mix = Math.max(0, Math.min(1, num(slice['mix'], 0)));
      target.setRGB(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);
      ground.material.color.copy(ground.baseColor).lerp(target, mix);
      ground.material.roughness =
        ground.baseRoughness + (num(slice['roughness'], ground.baseRoughness) - ground.baseRoughness) * mix;
    },
    dispose() {
      ground?.reset();
    },
  };
};

/** Primitive name -> how it is drawn. A name with no binding is state without a picture. */
export const BINDINGS: Readonly<Record<string, BindingFactory>> = {
  'rain-emitter': rainBinding,
  'snow-emitter': rainBinding,
  'fog-volume': fogBinding,
  'wind-field': windBinding,
  'tower': towerBinding,
  'skyline-shift': skylineBinding,
  'ground-tint': groundBinding,
};
