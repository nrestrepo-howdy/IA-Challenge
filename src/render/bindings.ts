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
  InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshStandardMaterial,
  PlaneGeometry, Points, PointsMaterial, Quaternion, Scene, Vector3,
} from 'three/webgpu';
import { sceneHandles, type SkyState } from './scene.js';

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

/**
 * The time of day.
 *
 * The largest visual change in the project, and the one that most needed a structure:
 * a sky is not one colour, it is a dozen values that have to agree with each other, and
 * a binding that interpolated each of them by hand would eventually forget one and
 * leave the stars up at noon. So the palette is authored as four *whole skies* —
 * midnight, dawn, noon, dusk — and the binding's only job is to sample between them at
 * the phase the primitive publishes and hand the result to `SkyHandle.apply()` in one
 * piece.
 *
 * Sampling rather than easing is what makes the change a cross-fade rather than a cut,
 * and it is free: `phaseNow` already sweeps forward around the clock (see
 * `world/daylight.ts`), so drawing the sky at whatever time it currently *is* passes
 * through dawn on the way to noon without this module knowing what a transition is.
 *
 * Midnight is not authored here. It is `handle.authored` — the sky the base scene
 * actually built — so the world at phase 0 and the world after `dispose()` are the same
 * object, not two hand-copied palettes that drift apart the first time the base scene
 * is retuned (AC-12).
 */
export const daylightBinding: BindingFactory = (scene, statePath) => {
  const handles = sceneHandles(scene);
  const sky = handles?.sky ?? null;

  /**
   * Sunrise. The horizon takes the colour and the zenith stays night: a dawn where the
   * whole dome warms up reads as a colour filter over the scene rather than as light
   * arriving from one side of it.
   */
  const DAWN: SkyState = {
    horizon: new Color(0.98, 0.46, 0.26),
    zenith: new Color(0.09, 0.15, 0.36),
    discPosition: new Vector3(-1290, 95, -880),
    discColor: new Color(1, 0.66, 0.36),
    // Low sun, large disc: the same atmospheric read that makes a real sunrise huge.
    discRadius: 66,
    haloColor: new Color(1, 0.45, 0.22),
    haloOpacity: 0.34,
    // Not zero. The last stars go out after the horizon lights up, and a sky that
    // loses all of them the instant it warms reads as a switch being thrown.
    starOpacity: 0.16,
    keyColor: new Color(1, 0.63, 0.38),
    keyIntensity: 1.9,
    ambientColor: new Color(0.52, 0.38, 0.42),
    ambientIntensity: 0.85,
    fogColor: new Color(0.5, 0.28, 0.26),
    groundEmissive: new Color(0.075, 0.05, 0.05),
    // Half the windows are still on at dawn, which is what makes it read as early
    // rather than as a pale noon.
    windowGlow: 0.55,
  };

  const NOON: SkyState = {
    horizon: new Color(0.68, 0.82, 0.97),
    zenith: new Color(0.16, 0.4, 0.82),
    discPosition: new Vector3(430, 1420, -620),
    discColor: new Color(1, 0.99, 0.94),
    // High sun, small disc.
    discRadius: 32,
    haloColor: new Color(1, 0.95, 0.76),
    haloOpacity: 0.1,
    starOpacity: 0,
    keyColor: new Color(1, 0.97, 0.9),
    keyIntensity: 3.4,
    ambientColor: new Color(0.6, 0.7, 0.88),
    ambientIntensity: 1.5,
    fogColor: new Color(0.7, 0.81, 0.95),
    // The authored ground is near-black by design, and no amount of light makes a
    // near-zero albedo bright: at noon it would still read as a hole under a blue sky.
    // `emissive` is the lift, and it is deliberately the *only* channel this binding
    // touches on that material — `ground-tint` owns `color` and `roughness` — so the
    // two verbs compose instead of overwriting each other.
    groundEmissive: new Color(0.2, 0.215, 0.235),
    windowGlow: 0,
  };

  const DUSK: SkyState = {
    horizon: new Color(1, 0.34, 0.2),
    zenith: new Color(0.15, 0.09, 0.3),
    discPosition: new Vector3(1210, 110, -930),
    discColor: new Color(1, 0.42, 0.2),
    discRadius: 70,
    haloColor: new Color(1, 0.3, 0.16),
    haloOpacity: 0.36,
    starOpacity: 0.22,
    keyColor: new Color(1, 0.47, 0.28),
    keyIntensity: 1.7,
    ambientColor: new Color(0.44, 0.26, 0.34),
    ambientIntensity: 0.72,
    fogColor: new Color(0.56, 0.26, 0.24),
    groundEmissive: new Color(0.07, 0.04, 0.045),
    // The city switching its lights back on is most of what says "evening".
    windowGlow: 0.8,
  };

  // Sorted, and wrapping: the segment after dusk is midnight again, one turn on, which
  // is what lets a sweep across the top of the clock be an ordinary interpolation
  // rather than a special case.
  const keys: readonly { readonly phase: number; readonly state: SkyState }[] = sky
    ? [
        { phase: 0, state: sky.authored },
        { phase: 0.25, state: DAWN },
        { phase: 0.5, state: NOON },
        { phase: 0.75, state: DUSK },
        { phase: 1, state: sky.authored },
      ]
    : [];

  // One scratch sky, reused every frame. `apply()` copies out of it, so the whole verb
  // costs no allocation inside the loop (R-9).
  const scratch: SkyState = {
    horizon: new Color(), zenith: new Color(), discPosition: new Vector3(),
    discColor: new Color(), discRadius: 0, haloColor: new Color(), haloOpacity: 0,
    starOpacity: 0, keyColor: new Color(), keyIntensity: 0, ambientColor: new Color(),
    ambientIntensity: 0, fogColor: new Color(), groundEmissive: new Color(),
    windowGlow: 0,
  };
  const mutable = scratch as {
    -readonly [K in keyof SkyState]: SkyState[K];
  };

  let lastPhase = Number.NaN;

  return {
    statePath,
    update(slice) {
      if (!sky) return;
      const phase = ((num(slice['phaseNow'], 0) % 1) + 1) % 1;
      // Repainting 2400 sky vertices for a sky that has finished moving is budget spent
      // for no picture. The threshold is well below a visible step in any channel.
      if (Math.abs(phase - lastPhase) < 1e-4) return;
      lastPhase = phase;

      let i = 0;
      while (i < keys.length - 2 && phase >= keys[i + 1]!.phase) i++;
      const a = keys[i]!, b = keys[i + 1]!;
      const t = (phase - a.phase) / (b.phase - a.phase);
      lerpSky(mutable, a.state, b.state, t);
      sky.apply(scratch);
    },
    dispose() {
      sky?.reset();
    },
  };
};

/** Component-wise, into `out`. Colours blend in the renderer's working space. */
function lerpSky(
  out: { -readonly [K in keyof SkyState]: SkyState[K] },
  a: SkyState,
  b: SkyState,
  t: number,
): void {
  out.horizon.copy(a.horizon).lerp(b.horizon, t);
  out.zenith.copy(a.zenith).lerp(b.zenith, t);
  out.discPosition.copy(a.discPosition).lerp(b.discPosition, t);
  out.discColor.copy(a.discColor).lerp(b.discColor, t);
  out.discRadius = a.discRadius + (b.discRadius - a.discRadius) * t;
  out.haloColor.copy(a.haloColor).lerp(b.haloColor, t);
  out.haloOpacity = a.haloOpacity + (b.haloOpacity - a.haloOpacity) * t;
  out.starOpacity = a.starOpacity + (b.starOpacity - a.starOpacity) * t;
  out.keyColor.copy(a.keyColor).lerp(b.keyColor, t);
  out.keyIntensity = a.keyIntensity + (b.keyIntensity - a.keyIntensity) * t;
  out.ambientColor.copy(a.ambientColor).lerp(b.ambientColor, t);
  out.ambientIntensity = a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * t;
  out.fogColor.copy(a.fogColor).lerp(b.fogColor, t);
  out.groundEmissive.copy(a.groundEmissive).lerp(b.groundEmissive, t);
  out.windowGlow = a.windowGlow + (b.windowGlow - a.windowGlow) * t;
}

/**
 * Water: a displaced, near-specular plane at the level the primitive publishes.
 *
 * What makes a surface read as water is that it moves and that it answers the light,
 * so the swell is real geometry and the normals are computed from the same wave
 * function analytically. Recomputing them from the triangles instead would cost a full
 * `computeVertexNormals()` every frame for a surface whose derivative we already have
 * in closed form (R-9), and a flat-normalled plane gets no specular at all — which is
 * to say it would not look like water.
 *
 * The height is drawn from `levelNow`, the authoritative value the contract asserts
 * over, so water that is half-risen in state is half-risen on screen.
 */
/** The three wave trains' amplitudes, summed: the deepest trough the swell can reach. */
const SWELL_SUM = 1 + 0.72 + 1.35;

export const waterBinding: BindingFactory = (scene, statePath) => {
  // Matches the authored ground plane, so the waterline reaches the horizon instead of
  // ending in a visible edge the fog has to hide.
  const SEGMENTS = 96;
  const geometry = new PlaneGeometry(4000, 4000, SEGMENTS, SEGMENTS);
  const position = geometry.getAttribute('position') as BufferAttribute;
  const normal = geometry.getAttribute('normal') as BufferAttribute;
  const pos = position.array as Float32Array;
  const nrm = normal.array as Float32Array;
  const material = new MeshStandardMaterial({
    // Metalness below 1 on purpose: a fully metallic surface with no environment map
    // renders black except where a light happens to reflect, which at this camera
    // angle is most of the water most of the time.
    color: new Color(0.03, 0.09, 0.16), roughness: 0.12, metalness: 0.55,
    transparent: true, opacity: 0.94,
  });
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    statePath,
    update(slice) {
      const phase = num(slice['wavePhase'], 0);
      const choppiness = num(slice['choppiness'], 1);
      mesh.position.y = num(slice['levelNow'], 0);

      // Three trains at different scales and speeds: one sine is a corrugated roof,
      // and two that share a period beat visibly against each other.
      const amp = 0.35 + choppiness * 0.95;
      for (let i = 0; i < position.count; i++) {
        // Plane-local, so `x` is world x and `y` is world -z; the mesh's own rotation
        // carries the displaced `z` up into world height.
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        const p1 = x * 0.0182 + phase * 1.0;
        const p2 = y * 0.0213 + phase * 1.31;
        const p3 = (x + y) * 0.0071 + phase * 0.63;
        // Biased so the swell sits entirely *above* `levelNow` rather than either side
        // of it. The authored ground is a hard plane, so a trough that dips below the
        // waterline does not read as a trough — it punches a hole in the water and
        // shows the floor through it, which is what the first screenshot did.
        pos[i * 3 + 2] =
          amp * (Math.sin(p1) + 0.72 * Math.sin(p2) + 1.35 * Math.sin(p3) + SWELL_SUM);
        // dh/dx, dh/dy of exactly the height above: the normal and the surface can
        // never disagree, which is what a numerical estimate cannot promise.
        const dx = amp * (0.0182 * Math.cos(p1) + 1.35 * 0.0071 * Math.cos(p3));
        const dy = amp * (0.72 * 0.0213 * Math.cos(p2) + 1.35 * 0.0071 * Math.cos(p3));
        const inv = 1 / Math.hypot(dx, dy, 1);
        nrm[i * 3] = -dx * inv;
        nrm[i * 3 + 1] = -dy * inv;
        nrm[i * 3 + 2] = inv;
      }
      position.needsUpdate = true;
      normal.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
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
  'daylight': daylightBinding,
  'water': waterBinding,
};
