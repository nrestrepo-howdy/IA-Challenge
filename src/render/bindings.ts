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
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry,
  CanvasTexture, Color, CylinderGeometry, DataTexture, DoubleSide,
  EquirectangularReflectionMapping, Fog, InstancedMesh, LineBasicMaterial, LineSegments,
  Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  CapsuleGeometry, Euler, Object3D, PlaneGeometry, Points, PointsMaterial, Quaternion, RingGeometry,
  RGBAFormat, Scene, SphereGeometry, Vector3,
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
  // Above white on purpose. A drop is a specular highlight, and until the streaks
  // crossed the bloom threshold in `post.ts` they were grey scratches with no wet
  // read at all. Additive blending multiplies this by `opacity`, so only rain at
  // full density gets over the line and bleeds.
  const material = new LineBasicMaterial({
    color: new Color(0.66, 0.76, 0.94).multiplyScalar(2.8),
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


/**
 * Snow. Not rain with different numbers.
 *
 * `'snow-emitter'` was mapped to `rainBinding`, so asking for snow drew vertical
 * streaks — the verb resolved, the contract passed, and the picture was of the wrong
 * weather. A binding that draws the wrong thing is worse than one that draws nothing,
 * because nothing is visibly missing and wrong is not.
 *
 * What separates them is not speed, it is *shape*: rain is a streak because a drop
 * moves far within one frame, and snow is a disc because a flake does not. Flakes also
 * drift laterally, wander on their own phase, and vary in size with distance, which is
 * what makes a field of them read as depth rather than as static.
 */
export const snowBinding: BindingFactory = (scene, statePath) => {
  const MAX = 9000;
  const geometry = new BufferGeometry();
  const positions = new Float32Array(MAX * 3);
  const seeds = new Float32Array(MAX);
  const sway = new Float32Array(MAX);
  for (let i = 0; i < MAX; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 1100;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 1100;
    seeds[i] = Math.random();
    sway[i] = 0.4 + Math.random() * 1.6;
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3));

  // A soft radial disc, drawn once into a canvas. A square point reads as a pixel;
  // a disc with a falloff reads as a flake, and it costs one 32x32 texture.
  const flake = document.createElement('canvas');
  flake.width = flake.height = 32;
  const fx = flake.getContext('2d')!;
  const grad = fx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  fx.fillStyle = grad;
  fx.fillRect(0, 0, 32, 32);
  const sprite = new CanvasTexture(flake);

  const material = new PointsMaterial({
    size: 9, map: sprite, transparent: true, opacity: 0.95,
    depthWrite: false, sizeAttenuation: true,
    color: new Color(0.94, 0.96, 1),
  });
  const snow = new Points(geometry, material);
  snow.frustumCulled = false;
  scene.add(snow);

  let elapsed = 0;
  let fallen = 0;
  return {
    statePath,
    update(slice, dt) {
      elapsed += dt;
      // The field names are the primitive's, read from its own header comment — not
      // guessed. The first version of this binding read `count`, `headY` and `spread`,
      // none of which `snow-emitter` publishes, so it drew nothing while the contract
      // passed. That is the fourth binding in this project to read a key nobody wrote,
      // and every one of them was invisible to the tests because contracts assert over
      // state and bindings reach into it by string.
      const count = Math.min(MAX, Math.max(0, Math.floor(num(slice['particles'], 0))));
      const lateral = num(slice['lateral'], 0);
      const fall = num(slice['fallSpeed'], 26);
      // The binding owns the fall, because the primitive does not publish one.
      // `rain-emitter` publishes `headY` and the rain binding reads it, which is the
      // better arrangement: one authoritative value drives both the contract and the
      // picture. Snow publishes phase and wander only, so the column position is the
      // renderer's own — and that is written down rather than left to be discovered by
      // whoever next wonders why the two emitters differ.
      const spread = 460;
      fallen = (fallen + fall * dt) % spread;
      const headY = spread - fallen;
      geometry.setDrawRange(0, count);
      const attr = geometry.getAttribute('position') as BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const s = seeds[i]!;
        arr[i * 3 + 1] = ((headY - s * spread) % spread + spread) % spread;
        // Each flake carries its own phase, so the field never pulses in unison —
        // synchronised sway is the tell that turns snow back into a particle system.
        // Lateral comes from the primitive's own published wander, so the picture and
        // the contract move together instead of agreeing by coincidence.
        arr[i * 3] = (arr[i * 3] ?? 0) + Math.sin(elapsed * sway[i]! + s * 6.28) * dt * 9 + lateral * dt * 0.6;
      }
      attr.needsUpdate = true;
      material.opacity = 0.62 + 0.33 * Math.min(1, count / 5000);
    },
    dispose() {
      scene.remove(snow);
      geometry.dispose();
      material.dispose();
      sprite.dispose();
    },
  };
};

/** The catalogue's maximum for `fog-volume.density`. Pinned by a test, not by trust. */
export const FOG_MAX_DENSITY = 0.2;

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
      // The catalogue declares `density` as 0.001..0.2. This read it as though it were
      // 0..1, so the whole expressible range mapped to a far plane of 1120..1399 in a
      // scene about 1400 deep: every fog the model could ask for was no fog. L3 said so
      // the first time it was asked, on the plainest request in the demo — "add fog":
      // "no atmospheric haze is visible: distant towers read at full contrast".
      //
      // `tests/render/fog-density.test.ts` pins MAX_DENSITY to the catalogue so this
      // cannot drift back apart. Squared, because halfway along the range should read
      // as fog rather than as slightly shorter draw distance.
      const t = Math.min(1, Math.max(0, density / FOG_MAX_DENSITY));
      const far = 140 + 1260 * (1 - t) ** 2;
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
    // The rim turns over with the light. A cool edge on a warm sunrise would read as
    // two suns, which is the one thing a sunrise cannot have.
    rimColor: new Color(1, 0.52, 0.32),
    rimIntensity: 0.55,
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
    // Nearly off. Overhead light already separates the faces of a box by value, so a
    // rim at noon adds a halo nothing in the scene is casting.
    rimColor: new Color(0.62, 0.7, 0.85),
    rimIntensity: 0.28,
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
    rimColor: new Color(1, 0.46, 0.3),
    rimIntensity: 0.6,
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
    windowGlow: 0, rimColor: new Color(), rimIntensity: 0,
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
  out.rimColor.copy(a.rimColor).lerp(b.rimColor, t);
  out.rimIntensity = a.rimIntensity + (b.rimIntensity - a.rimIntensity) * t;
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

/**
 * A sky for the water to reflect.
 *
 * The surface was a smooth metal plane in a scene with no environment map, so it
 * reflected the two lights the night city has and nothing else — which is to say it
 * rendered as dark ground, and L3 said exactly that on "the city is flooded": "no water
 * is visible: the base plane reads as dark ground". Roughness and metalness were both
 * already right; there was simply nothing in the world for them to work on.
 *
 * Equirectangular, 64x32, built once and shared: a bright band at the horizon over a
 * dark dome, which is what a night sky gives water to hold. It goes on the water's own
 * material rather than on `scene.environment`, because the second would put a sheen on
 * every building in the city to fix a plane none of them touch.
 */
function nightSkyEnvironment(): DataTexture {
  const w = 64, h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    // Brightest just above the horizon and falling off both ways: the gradient is the
    // reflection, so its shape is the whole of what the water looks like.
    const horizon = Math.exp(-((v - 0.5) ** 2) / 0.0016);
    const up = Math.max(0, 1 - v * 2);
    const r = 6 + 44 * horizon + 4 * up;
    const g = 10 + 56 * horizon + 8 * up;
    const b = 20 + 78 * horizon + 20 * up;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data[o] = Math.min(255, r); data[o + 1] = Math.min(255, g);
      data[o + 2] = Math.min(255, b); data[o + 3] = 255;
    }
  }
  const texture = new DataTexture(data, w, h, RGBAFormat);
  texture.mapping = EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}

export const waterBinding: BindingFactory = (scene, statePath) => {
  // A sea *around* the city, not a sheet *through* it.
  //
  // This was a 4000-unit plane centred on the origin, and the camera orbits inside that
  // at a radius of 150 to 280 and a height of about 34 — so the surface passed under
  // and around the viewpoint, and there was no level at which it could be seen. Below
  // about 25 it fell outside a frame that looks upward at 300-unit towers; at 38 it
  // filled the whole frame with a veil the city showed through; at 150 it was overhead,
  // and a single-sided plane seen from beneath is not drawn at all. Every one of those
  // is a correct rendering of the wrong shape, which is why L3 kept reporting no water
  // over a primitive whose state was moving exactly as its contract said.
  //
  // An annulus starting at 420 clears the orbit entirely — the dolly reaches 280. What it draws is a sea
  // beginning past the edge of the city and running to the horizon, which is both the
  // thing that can actually be seen from street level and the thing "amanece sobre el
  // mar" is asking for.
  const geometry = new RingGeometry(420, 2400, 128, 24);
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
    // Visible from underneath, which is most of why it was never visible at all. The
    // camera orbits at about fifty units; the catalogue lets `level` reach 260, and a
    // single-sided plane above the camera is a plane seen from its culled face. A
    // flood the model set to 150 drew nothing — the primitive published `levelNow: 150`
    // and `mix: 1`, the binding was constructed, and the surface was simply facing the
    // other way. Seeing the underside of the water you are standing in is also the
    // truthful picture.
    side: DoubleSide,
  });
  const environment = nightSkyEnvironment();
  material.envMap = environment;
  // The reflection is the only thing distinguishing this plane from the ground it sits
  // on, and it is also the thing that will swallow the city if it is too bright: the
  // camera orbits twelve units above a typical waterline, so the surface is seen at a
  // grazing angle and the horizon band is most of what it shows. A wide bright band
  // there rendered as milky haze over the lower half of the frame.
  material.envMapIntensity = 0.9;
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
      environment.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
};

// ─── the world stops being still ─────────────────────────────────────────────
// Three bindings for the three verbs that made the world alive rather than merely
// weathered. All three draw from a clock the primitive publishes rather than from one
// of their own: a binding with a private `elapsed` would keep animating a primitive
// that had stopped, which is precisely the "looks right, does nothing" failure L2 is
// blind to (D-1) and this layer must not manufacture.

/**
 * Aurora curtains: ribbons of light in the upper sky.
 *
 * Drawn as vertex-coloured strips with additive blending, never as a shader. Raw GLSL
 * is not dependable under `WebGPURenderer` and a sky effect that silently falls back to
 * a flat fill is the hardest failure to notice — the base scene's own gradient is built
 * the same way, for the same reason.
 *
 * The colour is carried entirely by the vertex attribute, so the fade to nothing at the
 * top of a curtain costs no alpha channel: additively blending black is invisible.
 * That is also what lets the whole verb be one draw call for up to six bands.
 *
 * Brightness comes from `glow`, which is already `intensity` times the fade-in times
 * the daylight visibility the primitive computed — so an aurora at noon draws black
 * geometry rather than this module having to know what time it is.
 */
export const auroraBinding: BindingFactory = (scene, statePath) => {
  // The schema's maximum. Allocated once: a geometry cannot grow, and rebuilding one
  // mid-verb is how an injection drops a frame (AC-14).
  const MAX_BANDS = 6;
  /** Columns per ribbon. Enough for the serpentine to read as a curve, not a fold. */
  const COLS = 44;
  /**
   * Three rows, not two. With two, a ribbon's only vertical gradient runs from one edge
   * to the other, so both edges are as bright as the colour put there — and the foot,
   * being a straight horizontal line of bright green across the sky, read as the bottom
   * of a pane of glass. L3 looked at it and reported no aurora at all: "the sky holds
   * only stars and a moon", of a frame with a teal slab across a third of it.
   *
   * A middle row lets the light live in the middle and fall off at both edges, which is
   * the whole difference between a curtain and a sheet.
   */
  const ROWS = 3;
  const PER_BAND = (COLS + 1) * ROWS;

  const geometry = new BufferGeometry();
  const positions = new Float32Array(MAX_BANDS * PER_BAND * 3);
  const colors = new Float32Array(MAX_BANDS * PER_BAND * 3);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  // Indices band by band, so the visible band count is a prefix of the index buffer
  // and `bands` costs a draw-range change rather than a rebuild.
  const indices: number[] = [];
  for (let b = 0; b < MAX_BANDS; b++) {
    const base = b * PER_BAND;
    for (let i = 0; i < COLS; i++) {
      for (let r = 0; r < ROWS - 1; r++) {
        const a = base + i * ROWS + r;
        const c = base + (i + 1) * ROWS + r;
        indices.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
  }
  geometry.setIndex(indices);

  // `color` multiplies the vertex attribute, so this is a display gain over the whole
  // curtain and nothing about the state it is drawn from changes. It is here so the
  // brightest cores of a ribbon clear the bloom threshold: an aurora whose light does
  // not leave its own geometry is a painted band with a cut edge, which is what the
  // first screenshot showed.
  const material = new MeshBasicMaterial({
    // 0.55, down from 0.85: additive blending at near-full opacity over a wide arc is a
    // light source the size of the sky, and it flattened into one colour.
    vertexColors: true, transparent: true, opacity: 0.55, color: new Color(1.25, 1.25, 1.25),
    blending: AdditiveBlending, depthWrite: false, fog: false, side: DoubleSide,
  });
  const curtains = new Mesh(geometry, material);
  curtains.frustumCulled = false;
  scene.add(curtains);

  const posAttr = geometry.getAttribute('position') as BufferAttribute;
  const colAttr = geometry.getAttribute('color') as BufferAttribute;
  const low = new Color(), high = new Color();

  return {
    statePath,
    update(slice) {
      const bands = Math.max(0, Math.min(MAX_BANDS, Math.round(num(slice['bands'], 0))));
      const phase = num(slice['curtainPhase'], 0);
      const hue = num(slice['hue'], 0.42);
      // Clamped rather than trusted: the schema tops out at 4, and an additive pass at
      // four times white is a white rectangle where an aurora was asked for.
      const glow = Math.max(0, Math.min(1.35, num(slice['glow'], 0) * 0.55));

      // Green low, magenta high — the vertical colour split is what a real aurora does
      // and it is most of what makes the shape read as depth rather than as a decal.
      low.setHSL(hue, 0.85, 0.5 * glow);
      high.setHSL((hue + 0.16) % 1, 0.8, 0.3 * glow);

      // Fewer bands, wider each: one lone ribbon spanning 30 degrees of a sky the
      // camera takes four minutes to orbit is a verb the user would have to wait for.
      // Capped at about 125 degrees. The old ceiling of 4.4 radians is 252 degrees —
      // one ribbon wrapping most of the way round the sky, which cannot read as a
      // ribbon from inside it.
      const arc = Math.max(1.0, Math.min(2.2, (Math.PI * 2 * 1.4) / Math.max(1, bands)));

      for (let b = 0; b < bands; b++) {
        const centre = (b / Math.max(1, bands)) * Math.PI * 2;
        for (let i = 0; i <= COLS; i++) {
          const u = i / COLS;
          const azimuth = centre + (u - 0.5) * arc;
          const radius = 1400 + 170 * Math.sin(u * 4.1 + phase * 7 + b);
          // High in the sky, not along the skyline. These sat at a foot of 235 and a
          // height of 300 — about seven degrees above the horizon at this radius, which
          // put the curtains behind the towers and out of frame. L3 reported the sky as
          // containing "only stars and a moon" while the aurora was rendering correctly
          // underneath the city. Now they span roughly 13 to 46 degrees of elevation,
          // which is where one is actually seen.
          const foot = 620 + 180 * Math.sin(u * 2.7 + phase * 5 + b * 1.7);
          const height = 520 + 240 * Math.sin(u * 3.3 + phase * 4 + b * 2.3);
          const cx = Math.cos(azimuth) * radius;
          const cz = Math.sin(azimuth) * radius;

          const o = (b * PER_BAND + i * ROWS) * 3;
          const rays = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(u * 27 + phase * 21 + b * 3));
          const taper = Math.sin(Math.PI * u);
          const k = rays * taper * taper;

          // Dim at the foot, brightest just above it, fading out through the top: the
          // vertical profile of a curtain. The ends of the ribbon taper to nothing so it
          // has no cut edge hanging in the air, and the rays drifting along it are what
          // make it something moving through the sky rather than a painted band.
          for (let r = 0; r < ROWS; r++) {
            const v = r / (ROWS - 1);
            positions[o + r * 3] = cx;
            positions[o + r * 3 + 1] = foot + height * v * v;
            positions[o + r * 3 + 2] = cz;

            // 0 at the foot, 1 at the bright band, falling away above it. `<=` matters:
            // the middle row is the bright core and it must take the green, or the whole
            // curtain draws in the fringe colour and the vertical split disappears.
            const profile = v < 0.5 ? v * 2 : 1 - (v - 0.5) * 1.7;
            const c = v <= 0.5 ? low : high;
            const g = k * Math.max(0, profile);
            colors[o + r * 3] = c.r * g;
            colors[o + r * 3 + 1] = c.g * g;
            colors[o + r * 3 + 2] = c.b * g;
          }
        }
      }

      geometry.setDrawRange(0, bands * COLS * (ROWS - 1) * 6);
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    },
    dispose() {
      scene.remove(curtains);
      geometry.dispose();
      material.dispose();
    },
  };
};

/**
 * Birds, scattered around the centroid the primitive is flying.
 *
 * Two segments each, hinged at the body: a bird drawn as a dot is indistinguishable
 * from the star field it flies across, and the flap is what separates a flock from
 * confetti. Every offset is a pure function of the bird's index, so the same flock
 * comes back on every run and a screenshot is a fact — `Math.random()` here would put
 * the picture outside the seed the rest of the system is reproducible from.
 *
 * The whole flock is one `LineSegments`: 400 birds at the schema's maximum is 1600
 * vertices in a single draw call, against a scene already carrying 260 instanced
 * buildings and up to 14000 rain segments (R-9).
 */
export const flockBinding: BindingFactory = (scene, statePath) => {
  const MAX = 400;
  const geometry = new BufferGeometry();
  const positions = new Float32Array(MAX * 4 * 3);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({
    // Pale rather than silhouette: the sky behind them is the darkest thing in the
    // authored frame, so a dark bird is a bird nobody can find.
    color: new Color(0.86, 0.89, 0.98), transparent: true, opacity: 0.92,
    depthWrite: false,
  });
  const birds = new LineSegments(geometry, material);
  birds.frustumCulled = false;
  scene.add(birds);

  const attr = geometry.getAttribute('position') as BufferAttribute;

  return {
    statePath,
    update(slice) {
      const count = Math.max(0, Math.min(MAX, Math.round(num(slice['birds'], 0))));
      const centre = Array.isArray(slice['centroid']) ? (slice['centroid'] as number[]) : null;
      if (!centre) return;
      const heading = num(slice['heading'], 0);
      const wing = num(slice['wingPhase'], 0);
      const spread = num(slice['spread'], 40);

      const cx = num(centre[0], 0), cy = num(centre[1], 0), cz = num(centre[2], 0);
      // The flock's own frame: forward along the heading, `side` across it. The birds
      // bank with the flock rather than each pointing wherever it was born.
      const fx = Math.cos(heading), fz = Math.sin(heading);
      const sx = -fz, sz = fx;
      const span = 3.4;

      for (let i = 0; i < count; i++) {
        // Three decorrelated hashes per bird: where it sits in the flock, and how far
        // out of step its wings are with its neighbours'.
        const a = wobble(i * 3 + 1), b = wobble(i * 3 + 2), c = wobble(i * 3 + 3);
        // Loose ellipsoid, longer along the heading: a flock is a stream, not a ball.
        const along = (a - 0.5) * spread * 2.4;
        const across = (b - 0.5) * spread * 1.5;
        // Individual drift, so the formation churns instead of holding rigid — a flock
        // whose members never change places is a constellation being towed.
        const churn = Math.sin(wing * 0.37 + c * 6.283) * spread * 0.22;
        const rise = (c - 0.5) * spread * 0.75 + Math.sin(wing * 0.29 + a * 6.283) * spread * 0.2;

        const px = cx + fx * along + sx * (across + churn);
        const py = cy + rise;
        const pz = cz + fz * along + sz * (across + churn);

        // Wings: down-swept at the top of the beat, level at the bottom. Each bird is
        // offset in the cycle, because a flock beating in unison is a machine.
        const flap = Math.sin(wing * 6.283 + c * 6.283);
        const lift = flap * span * 0.85;
        const o = i * 12;
        positions[o] = px + sx * span; positions[o + 1] = py + lift; positions[o + 2] = pz + sz * span;
        positions[o + 3] = px; positions[o + 4] = py; positions[o + 5] = pz;
        positions[o + 6] = px; positions[o + 7] = py; positions[o + 8] = pz;
        positions[o + 9] = px - sx * span; positions[o + 10] = py + lift; positions[o + 11] = pz - sz * span;
      }

      geometry.setDrawRange(0, count * 4);
      attr.needsUpdate = true;
    },
    dispose() {
      scene.remove(birds);
      geometry.dispose();
      material.dispose();
    },
  };
};

/**
 * Searchlight beams: an open cone per lamp, pointed where the primitive is aiming it.
 *
 * The cone is authored once as a unit and every beam is the same geometry scaled and
 * rotated, so `spread` costs a scale rather than a rebuild. Vertex colours fade the
 * beam out along its length: additively blending black is invisible, so the beam ends
 * in air rather than in a lid.
 *
 * No `SpotLight`. A real spot would light the buildings it crosses, which is the wrong
 * picture — what makes a beam visible at night is the haze *inside* it, not what it
 * lands on — and it would cost a shadow-capable light on a scene tuned to hold 16 ms
 * with 260 instanced buildings already in it (R-9).
 */
export const searchlightBinding: BindingFactory = (scene, statePath) => {
  const MAX = 8;
  /** Beam length, in world units: past the authored skyline's inner ring, into the sky. */
  const LENGTH = 1000;

  // Unit cone: apex-ish at the lamp, mouth at y = 1. Narrow at the base rather than a
  // true point, so the lamp itself has a visible source rather than vanishing.
  // Wider at the source and far softer along its length. A cone at uniform brightness
  // reads as a white polygon, not as light: a real beam is bright where it leaves the
  // lamp and dissolves into the haze, and that falloff is the whole illusion. More
  // radial segments because the silhouette of the cone is what gives it away.
  const geometry = new CylinderGeometry(1, 0.015, 1, 40, 1, true);
  geometry.translate(0, 0.5, 0);
  const position = geometry.getAttribute('position') as BufferAttribute;
  const tint = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    // Bright at the lamp, gone at the mouth. Cubed, because a linear falloff along a
    // thousand units reads as a solid wedge — and because the display gain below is
    // what lifts the lamp end over the bloom threshold, a squared curve carried too
    // much of the *body* of the beam up with it and washed the whole frame milky.
    const t = 1 - position.getY(i);
    const k = t * t * t;
    tint[i * 3] = 0.55 * k; tint[i * 3 + 1] = 0.72 * k; tint[i * 3 + 2] = k;
  }
  geometry.setAttribute('color', new BufferAttribute(tint, 3));

  // Same display gain as the aurora, for the same reason: the lamp end has to clear
  // the bloom threshold or the beam is a flat opaque wedge. The falloff along the
  // beam is quadratic, so only the first fraction of it bleeds -- which is what a
  // beam in air actually does.
  const material = new MeshBasicMaterial({
    // Dimmer than it was, and depth-tested so towers occlude it. At full brightness
    // with additive blending the cone saturated to white wherever two beams crossed,
    // which is the single most artificial thing that was in frame.
    vertexColors: true, transparent: true, opacity: 0, color: new Color(1.5, 1.6, 1.9),
    blending: AdditiveBlending, depthWrite: false, fog: true, side: DoubleSide,
  });

  const beams: Mesh[] = [];
  for (let i = 0; i < MAX; i++) {
    const beam = new Mesh(geometry, material);
    beam.visible = false;
    beam.frustumCulled = false;
    scene.add(beam);
    beams.push(beam);
  }

  const up = new Vector3(0, 1, 0);
  const dir = new Vector3();

  return {
    statePath,
    update(slice) {
      const lamps = Array.isArray(slice['lamps']) ? (slice['lamps'] as unknown[]) : [];
      const aim = Array.isArray(slice['aim']) ? (slice['aim'] as unknown[]) : [];
      const count = Math.min(MAX, lamps.length, aim.length);
      const spread = num(slice['spread'], 4);
      const glow = Math.max(0, Math.min(1, num(slice['glow'], 0)));
      material.opacity = 0.24 * glow;

      const radius = Math.tan((spread * Math.PI) / 180) * LENGTH;
      for (let i = 0; i < MAX; i++) {
        const beam = beams[i]!;
        beam.visible = i < count;
        if (i >= count) continue;
        const lamp = lamps[i] as number[] | undefined;
        const at = aim[i] as number[] | undefined;
        if (!lamp || !at) { beam.visible = false; continue; }

        const azimuth = num(at[0], 0);
        const tilt = num(at[1], 0);
        beam.position.set(num(lamp[0], 0), 2, num(lamp[1], 0));
        // The cone's own axis is +y, so the beam is rotated onto its direction rather
        // than composed out of Euler angles whose order would have to be remembered.
        dir.set(Math.sin(tilt) * Math.cos(azimuth), Math.cos(tilt), Math.sin(tilt) * Math.sin(azimuth));
        beam.quaternion.setFromUnitVectors(up, dir);
        beam.scale.set(radius, LENGTH, radius);
      }
    },
    dispose() {
      for (const beam of beams) scene.remove(beam);
      geometry.dispose();
      material.dispose();
    },
  };
};

/** A stable pseudo-random in [0, 1) from an integer. Same index, same bird, forever. */
function wobble(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Primitive name -> how it is drawn. A name with no binding is state without a picture. */
/**
 * Every rig in the world, from one binding.
 *
 * It is keyed on the `figures` parent rather than on one figure, because the set of
 * figures is not known until someone says something: a binding per rig would mean a
 * binding registry that changes at runtime, and `reconcile()` in main.ts builds its
 * bindings from the primitive list, which is fixed. So this reconciles the subtree —
 * a rig that appears gets meshes, a rig that is undone gets them disposed.
 *
 * It reads two things and trusts neither. `parts` is the descriptor and never changes,
 * so meshes are built from it once; `pose` is seven numbers per part per frame, and is
 * read defensively because the code that writes it was generated.
 */
export const figureBinding: BindingFactory = (scene, statePath) => {
  interface Rig {
    readonly root: Object3D;
    readonly meshes: Mesh[];
    readonly geometries: BufferGeometry[];
    readonly materials: MeshStandardMaterial[];
    /** What the descriptor looked like when the meshes were built. */
    readonly signature: string;
  }
  const rigs = new Map<string, Rig>();
  const euler = new Euler();

  function geometryFor(shape: string, size: readonly number[]): BufferGeometry {
    const [x = 1, y = 1, z = 1] = size;
    // Radii come from the widest horizontal half-extent: a capsule authored 0.3 x 1.2
    // x 0.3 is a limb, and reading only `x` would make an arm out of a thread.
    const radius = Math.max(0.01, Math.max(x, z));
    if (shape === 'sphere') return new SphereGeometry(radius, 18, 12);
    if (shape === 'capsule') return new CapsuleGeometry(radius, Math.max(0.01, y * 2), 6, 12);
    if (shape === 'cylinder') return new CylinderGeometry(radius, radius, Math.max(0.01, y * 2), 18);
    return new BoxGeometry(Math.max(0.01, x * 2), Math.max(0.01, y * 2), Math.max(0.01, z * 2));
  }

  function build(name: string, parts: readonly Record<string, unknown>[]): Rig {
    const root = new Object3D();
    root.frustumCulled = false;
    const meshes: Mesh[] = [];
    const geometries: BufferGeometry[] = [];
    const materials: MeshStandardMaterial[] = [];
    for (const part of parts) {
      const size = Array.isArray(part['size']) ? (part['size'] as number[]) : [1, 1, 1];
      const colour = Array.isArray(part['color']) ? (part['color'] as number[]) : [0.6, 0.6, 0.6];
      const glow = num(part['emissive'], 0);
      const geometry = geometryFor(String(part['shape'] ?? 'box'), size);
      const material = new MeshStandardMaterial({
        color: new Color(colour[0] ?? 0.6, colour[1] ?? 0.6, colour[2] ?? 0.6),
        roughness: 0.62, metalness: 0.08,
        emissive: new Color(colour[0] ?? 0.6, colour[1] ?? 0.6, colour[2] ?? 0.6),
        emissiveIntensity: Math.max(0, Math.min(1, glow)) * 2.2,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      root.add(mesh);
      meshes.push(mesh);
      geometries.push(geometry);
      materials.push(material);
    }
    scene.add(root);
    return { root, meshes, geometries, materials, signature: JSON.stringify(parts) };
  }

  function destroy(rig: Rig): void {
    scene.remove(rig.root);
    for (const g of rig.geometries) g.dispose();
    for (const m of rig.materials) m.dispose();
  }

  return {
    statePath,
    update(slice) {
      const seen = new Set<string>();
      for (const [name, value] of Object.entries(slice)) {
        if (!value || typeof value !== 'object') continue;
        const figure = value as Record<string, unknown>;
        const parts = figure['parts'];
        const pose = figure['pose'];
        if (!Array.isArray(parts) || !Array.isArray(pose)) continue;
        seen.add(name);

        const signature = JSON.stringify(parts);
        let rig = rigs.get(name);
        // Rebuilt only when the descriptor itself changes, which it does not — the
        // check is here so that a figure replaced under the same name cannot inherit
        // the previous rig's meshes.
        if (rig && rig.signature !== signature) { destroy(rig); rigs.delete(name); rig = undefined; }
        if (!rig) {
          rig = build(name, parts as Record<string, unknown>[]);
          rigs.set(name, rig);
        }

        for (let i = 0; i < rig.meshes.length; i++) {
          const o = i * 7;
          const mesh = rig.meshes[i]!;
          mesh.position.set(num(pose[o], 0), num(pose[o + 1], 0), num(pose[o + 2], 0));
          euler.set(num(pose[o + 4], 0), num(pose[o + 3], 0), num(pose[o + 5], 0), 'YXZ');
          mesh.quaternion.setFromEuler(euler);
          const scale = num(pose[o + 6], 1);
          mesh.scale.setScalar(scale > 0 ? scale : 1);
        }
      }
      // A rig whose slice is gone was undone. Its meshes go with it (AC-12).
      for (const [name, rig] of rigs) {
        if (seen.has(name)) continue;
        destroy(rig);
        rigs.delete(name);
      }
    },
    dispose() {
      for (const rig of rigs.values()) destroy(rig);
      rigs.clear();
    },
  };
};

/**
 * The falling bodies, as one instanced draw.
 *
 * Boxes rather than spheres, and the reason is the light: a sphere at this size is four
 * shaded pixels and reads as a dot, where a box catches the key on one face and the rim
 * on another and reads as a thing with edges. The rig primitives use spheres where a
 * sphere is the shape; this is rubble.
 *
 * Capacity is the catalogue's maximum, allocated once. An InstancedMesh cannot grow, and
 * rebuilding geometry mid-verb is how an injection drops a frame (AC-14).
 */
export const debrisBinding: BindingFactory = (scene, statePath) => {
  const CAPACITY = 400;
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshStandardMaterial({
    color: new Color(0.09, 0.095, 0.11), roughness: 0.82, metalness: 0.12,
    emissive: new Color(0.05, 0.045, 0.04), emissiveIntensity: 0.9,
  });
  const mesh = new InstancedMesh(geometry, material, CAPACITY);
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);

  const m = new Matrix4(), q = new Quaternion(), pos = new Vector3(), scl = new Vector3();
  const spin = new Vector3(0.57, 0.79, 0.21).normalize();

  return {
    statePath,
    update(slice) {
      const bodies = slice['bodies'];
      if (!Array.isArray(bodies)) { mesh.count = 0; return; }
      const size = num(slice['size'], 4);
      const shown = Math.min(CAPACITY, Math.floor(bodies.length / 3));

      for (let i = 0; i < shown; i++) {
        const o = i * 3;
        pos.set(num(bodies[o], 0), num(bodies[o + 1], 0), num(bodies[o + 2], 0));
        // Tumble derived from the body's own position rather than from a clock, so a
        // body at rest is visually at rest: a rotation driven by elapsed time keeps
        // spinning after the physics has stopped, which reads as a bug in the physics.
        q.setFromAxisAngle(spin, pos.x * 0.21 + pos.z * 0.13 + pos.y * 0.07);
        scl.setScalar(size);
        mesh.setMatrixAt(i, m.compose(pos, q, scl));
      }
      mesh.count = shown;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
};

export const BINDINGS: Readonly<Record<string, BindingFactory>> = {
  'rain-emitter': rainBinding,
  'snow-emitter': snowBinding,
  'fog-volume': fogBinding,
  'wind-field': windBinding,
  'tower': towerBinding,
  'skyline-shift': skylineBinding,
  'ground-tint': groundBinding,
  'daylight': daylightBinding,
  'water': waterBinding,
  'aurora': auroraBinding,
  'flock': flockBinding,
  'searchlights': searchlightBinding,
  'debris': debrisBinding,
  'figure': figureBinding,
};
