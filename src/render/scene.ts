/**
 * The base scene.
 *
 * Authored, not generated: SPEC §2 says Verbo starts from an authored world and the
 * agent extends it. A world that opens as a grey plane makes every later addition look
 * like a demo of a demo.
 *
 * The first version was exactly that, and a screenshot said so: flat boxes on flat
 * ground, every pixel inside a two-stop value range, no light source anywhere in frame.
 * What fixed it is not more geometry — it is **value range and a light anchor**. A sky
 * that goes somewhere, a moon that is actually visible, windows that are genuinely
 * bright, and silhouettes dark enough to read against all of it.
 */
import {
  AdditiveBlending, AmbientLight, BackSide, BoxGeometry,
  BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, LinearMipmapLinearFilter,
  DirectionalLight, Fog, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, MeshStandardNodeMaterial,
  PerspectiveCamera, PlaneGeometry, Points, PointsMaterial,
  ClampToEdgeWrapping, Quaternion, RepeatWrapping, SRGBColorSpace, Scene,
  SphereGeometry, Vector3,
} from 'three/webgpu';
import { abs, normalView, normalWorld, positionViewDirection, positionWorld, texture, uniform, vec2, vec3 } from 'three/tsl';

export interface BaseScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** 0..1 — how far the world has grown beyond its authored height. */
  setFraming(v: number): void;
  /** The authored city, for the binding of a primitive that reshapes it. */
  readonly skyline: SkylineHandle;
  /** The authored ground material, for the binding of a primitive that restates it. */
  readonly ground: GroundHandle;
  /** The authored sky, for the binding of the primitive that decides what time it is. */
  readonly sky: SkyHandle;
  resize(w: number, h: number): void;
  /**
   * Lets a viewer look around: drag to orbit, wheel to push in and out.
   *
   * Returns the detach function. The offsets ease back to zero after a few seconds of
   * stillness, so this adds a way to look without taking away the shot.
   */
  controls(el: HTMLElement): () => void;
  /**
   * @param focus  `[x, y, z, radius]` — where the world's subject is and how big it is.
   *               The camera frames it by its size rather than from a fixed distance.
   */
  update(elapsed: number, focus?: readonly [number, number, number, number] | null): void;
}

/**
 * The handle `skyline-shift` needs.
 *
 * Structural verbs are the first ones that change something the base scene already
 * drew, so the base scene has to hand out something to change. It hands out its own
 * geometry plus the two operations that keep it coherent — a building's lit windows
 * have to move with its roof, and there is exactly one correct way to do that, so it
 * lives here beside the data rather than being reimplemented by every caller. What the
 * binding still owns is the decision: *how tall*, *how many*, and *when*, all read from
 * world state.
 *
 * `reset()` is not a convenience. R-4 makes the module leak structural, so a binding's
 * `dispose()` is the only thing that can put the user's world back the way it was
 * (AC-12), and a scene that cannot be un-shifted would make `skyline-shift` a one-way
 * door.
 */
export interface SkylineHandle {
  readonly mesh: InstancedMesh;
  /** Instances the authored city uses. The mesh has capacity for more, for `density`. */
  readonly baseCount: number;
  /** Upper bound on `visible`; more than this is capacity the scene does not have. */
  readonly maxCount: number;
  /** Draws `visible` buildings at `heightScale` times their authored height. */
  apply(heightScale: number, visible: number): void;
  reset(): void;
}

/** The handle `ground-tint` needs: the material, and what it was before anyone touched it. */
export interface GroundHandle {
  readonly material: MeshStandardMaterial;
  readonly baseColor: Color;
  readonly baseRoughness: number;
  reset(): void;
}

/**
 * Everything the time of day decides, in one value.
 *
 * `daylight` is the one verb that touches almost every authored thing at once - the
 * gradient, the disc the light comes from, the stars, the key, the ambient fill, the
 * fog and the lit windows. Handing the binding a dozen setters would let it leave the
 * scene half-changed on a frame where one of them was forgotten, and a sky whose stars
 * belong to midnight and whose light belongs to noon is worse than either. So the
 * whole sky is set at once, from one struct, or not at all.
 *
 * Colours are read, never retained: `apply()` copies out of them, so a caller may reuse
 * one scratch value per frame rather than allocating a dozen inside the loop.
 */
export interface SkyState {
  readonly horizon: Color;
  readonly zenith: Color;
  /** Where the light comes from. The disc and the key light always agree on it. */
  readonly discPosition: Vector3;
  readonly discColor: Color;
  /** In world units. The sun does not subtend the moon's angle. */
  readonly discRadius: number;
  readonly haloColor: Color;
  readonly haloOpacity: number;
  readonly starOpacity: number;
  readonly keyColor: Color;
  readonly keyIntensity: number;
  readonly ambientColor: Color;
  readonly ambientIntensity: number;
  readonly fogColor: Color;
  /**
   * A daylight wash on the ground, written to the material's `emissive`.
   *
   * The authored ground is near-black, and no amount of light makes a near-zero albedo
   * bright — at noon it would read as a hole under a blue sky. `emissive` is the lift,
   * and keeping it to that one channel is what lets `daylight` and `ground-tint` both
   * touch this material without either one undoing the other: `ground-tint` owns
   * `color` and `roughness`, the time of day owns how much light there is.
   */
  readonly groundEmissive: Color;
  /** Multiplies the lit-window glow. Windows that stay lit at noon read as a bug. */
  readonly windowGlow: number;
  /**
   * The edge light on the buildings, and how much of it there is.
   *
   * A flat-shaded box lit from one side is two flat values with a hard corner between
   * them, which is why the city read as blocks rather than as architecture. A fresnel
   * term along the silhouette is what separates a building from whatever is behind it,
   * and it belongs to the time of day for the same reason the key does: a cool blue
   * rim is what midnight looks like and what noon does not, and a rim that stayed the
   * same colour all day would be the arbitrary global tint this scene avoids.
   */
  readonly rimColor: Color;
  readonly rimIntensity: number;
}

/**
 * The handle `daylight` needs.
 *
 * `authored` is captured at construction, before anything can have touched it, and it
 * is what `reset()` restores. R-4 makes the module leak structural, so a binding's
 * `dispose()` is the only thing that can put the world back (AC-12) - and a verb that
 * turned a permanent night into a permanent day would be a one-way door, not a verb.
 * It is also what the binding cross-fades *from*, so the fade converges on the
 * requested time instead of chasing its own previous frame.
 */
export interface SkyHandle {
  readonly authored: SkyState;
  apply(next: SkyState): void;
  reset(): void;
}

/** What a binding can reach through the `Scene` it is handed. */
export interface SceneHandles {
  readonly skyline: SkylineHandle;
  readonly ground: GroundHandle;
  readonly sky: SkyHandle;
}

/** Where the handles are parked on the scene graph. */
const HANDLES_KEY = 'verbo';

/**
 * The authored handles, reached from the `Scene` alone.
 *
 * A binding is constructed with a `Scene` and a state path — that is the seam `main.ts`
 * uses, and widening it would make every existing binding know about a base scene it
 * has no business knowing about. Structural bindings need more than the graph, so the
 * base scene parks its handles on `scene.userData` and they are read back through this
 * one typed accessor rather than by reaching into `userData` from four places.
 *
 * Returns null for any other `Scene` — a test's, or a shadow render's — so a binding
 * degrades to drawing nothing instead of throwing inside the frame loop.
 */
export function sceneHandles(scene: Scene): SceneHandles | null {
  const handles = (scene.userData as Record<string, unknown>)[HANDLES_KEY];
  return (handles as SceneHandles | undefined) ?? null;
}

/**
 * One volume of one building.
 *
 * `y0` and `h` are fractions of the building's height rather than world units, for the
 * same reason the windows are: `skyline-shift` multiplies a building's height, and a
 * setback expressed in units would stay where it was while the tower left without it.
 */
interface Box {
  /** Offset from the building's centre, in the building's own rotated frame. */
  readonly dx: number;
  readonly dz: number;
  readonly w: number;
  readonly d: number;
  readonly y0: number;
  readonly h: number;
}

/** One building: authored once, redrawn whenever the skyline is shifted. */
interface Slot {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly rotation: number;
  /**
   * The massing. A single box is a box; what makes a tower read as a tower is that it
   * changes as it rises — a shoulder, a setback, a crown, a mast. Every building here
   * is between two and five of these, chosen by archetype.
   */
  readonly boxes: readonly Box[];
  /** Window offsets from the building's centre, with the height fraction each sits at. */
  readonly windows: readonly { readonly dx: number; readonly dz: number; readonly t: number }[];
  /** Height fraction of the aviation beacon, or null on anything too short to carry one. */
  readonly beacon: number | null;
}

/** Deterministic: the scene is identical on every load, so a screenshot is a fact. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HORIZON = new Color(0.075, 0.094, 0.135);
const ZENITH = new Color(0.016, 0.021, 0.043);

/**
 * How far the emissive sources sit above white.
 *
 * Nothing in the scene exceeded 1.0 before, so the bloom threshold in `post.ts` had
 * nothing to find and the tone curve had no highlight to roll off — the moon clipped
 * to a flat disc and the windows were grey specks. These gains are what put the light
 * sources into the range where both stages have something to do; the *authored*
 * colours stay unscaled, because `SkyState` is also what `daylight` interpolates and
 * what `reset()` restores, and baking a display gain into it would make every preset
 * a number nobody could reason about.
 */
const DISC_GAIN = 3.4;
const WINDOW_GAIN = 3.0;
const STAR_GAIN = 2.4;
/**
 * Below 1 on purpose. The halo was doing the moon's glow by hand and read as exactly
 * what it is — a flat translucent sphere with a hard silhouette. Bloom does that job
 * properly now, so the painted version steps back to being the wide atmospheric skirt
 * that bloom's radius cannot reach.
 */
const HALO_GAIN = 0.22;

export function createBaseScene(): BaseScene {
  const scene = new Scene();
  const rand = rng(0x5eed);

  // ── Sky ────────────────────────────────────────────────────────────────────
  // A gradient baked into vertex colours rather than a GLSL ShaderMaterial. Raw GLSL
  // is not dependable under WebGPURenderer, and a sky that silently falls back to a
  // flat fill is exactly the failure that is hardest to notice: nothing errors, the
  // frame just goes dull. Vertex colours render identically on both backends.
  const skyGeo = new SphereGeometry(2400, 32, 24);
  const skyPos = skyGeo.getAttribute('position');
  const skyCol = new Float32Array(skyPos.count * 3);
  const c = new Color();
  // The per-vertex horizon->zenith blend, kept rather than recomputed. Repainting the
  // dome for a new time of day is the same curve with two different ends; deriving it
  // a second time would be a subtly different sky that only shows up at dawn.
  const skyBlend = new Float32Array(skyPos.count);
  for (let i = 0; i < skyPos.count; i++) {
    const y = skyPos.getY(i) / 2400;
    skyBlend[i] = Math.pow(Math.max(0, Math.min(1, y * 1.5 + 0.18)), 0.75);
    c.copy(HORIZON).lerp(ZENITH, skyBlend[i]!);
    skyCol[i * 3] = c.r; skyCol[i * 3 + 1] = c.g; skyCol[i * 3 + 2] = c.b;
  }
  const skyColorAttr = new BufferAttribute(skyCol, 3);
  skyGeo.setAttribute('color', skyColorAttr);
  const skyDome = new Mesh(skyGeo, new MeshBasicMaterial({
    side: BackSide, depthWrite: false, fog: false, vertexColors: true,
  }));
  skyDome.frustumCulled = false;
  scene.add(skyDome);
  scene.fog = new Fog(HORIZON, 260, 1600);

  // ── Stars ──────────────────────────────────────────────────────────────────
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(rand() * 0.85 + 0.05);
    const r = 2100;
    starPos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
    starPos[i * 3 + 1] = Math.cos(ph) * r;
    starPos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
  }
  const stars = new BufferGeometry();
  stars.setAttribute('position', new BufferAttribute(starPos, 3));
  const starMat = new PointsMaterial({
    size: 3.2, sizeAttenuation: false,
    color: new Color(0.75, 0.82, 1).multiplyScalar(STAR_GAIN),
    transparent: true, opacity: 0.55, depthWrite: false, fog: false,
  });
  const starField = new Points(stars, starMat);
  starField.frustumCulled = false;
  scene.add(starField);

  // ── Moon ───────────────────────────────────────────────────────────────────
  // In frame, and genuinely bright. Without a visible source, directional light reads
  // as an arbitrary global tint rather than as light coming from somewhere.
  // Authored at the moon's radius and scaled from it, because the sun does not subtend
  // the moon's angle: a disc that changes colour but not size reads as the same object
  // repainted rather than as a different body in the sky.
  const DISC_RADIUS = 46;
  const DISC_COLOR = new Color(0.96, 0.97, 1);
  const HALO_COLOR = new Color(0.45, 0.56, 0.85);
  const moonMat = new MeshBasicMaterial({
    color: DISC_COLOR.clone().multiplyScalar(DISC_GAIN), fog: false,
  });
  const moon = new Mesh(new SphereGeometry(DISC_RADIUS, 24, 16), moonMat);
  moon.position.set(-430, 330, -900);
  scene.add(moon);
  const haloMat = new MeshBasicMaterial({
    color: HALO_COLOR.clone(), transparent: true, opacity: 0.16 * HALO_GAIN,
    blending: AdditiveBlending, depthWrite: false, fog: false,
  });
  const halo = new Mesh(new SphereGeometry(150, 20, 14), haloMat);
  halo.position.copy(moon.position);
  scene.add(halo);

  // ── Ground ─────────────────────────────────────────────────────────────────
  const groundMaterial = new MeshStandardMaterial({
    // Wet-looking, not mirrored. metalness 0.62 against a 2.1 key clipped a
    // specular lobe to pure white right in front of the camera — the brightest
    // thing in frame was an artifact.
    color: new Color(0.026, 0.033, 0.048), roughness: 0.72, metalness: 0.18,
  });
  const groundMesh = new Mesh(new PlaneGeometry(4000, 4000), groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2;
  // Receives only. A ground plane that casts would shadow the world from underneath.
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);


  // The authored values are captured here, not in the binding: `ground-tint` blends
  // *from* what the world was made of, and a binding that read the current material
  // would blend from whatever the previous tint left behind and never find its way
  // home on dispose() (AC-12).
  const ground: GroundHandle = {
    material: groundMaterial,
    baseColor: groundMaterial.color.clone(),
    baseRoughness: groundMaterial.roughness,
    // Only the two channels this handle owns. `emissive` belongs to the time of day,
    // and resetting it here would make un-tinting the ground also un-do the daylight.
    reset() {
      groundMaterial.color.copy(this.baseColor);
      groundMaterial.roughness = this.baseRoughness;
    },
  };

  // ── Skyline ────────────────────────────────────────────────────────────────
  // Near-black, so it reads as silhouette against the sky. The previous version made
  // buildings and sky the same value, which is why nothing had an edge.
  //
  // The city is authored as data first and drawn from it second. That indirection is
  // what makes `skyline-shift` possible at all: a building's height has to be readable
  // to be multiplied, and its lit windows have to be expressed as a *fraction* of that
  // height or they stay at ground level while the roof leaves without them.
  const COUNT = 260;
  // Capacity for exactly twice the authored city, which is the schema's maximum
  // density. Instances are allocated once, at load: growing an InstancedMesh means
  // rebuilding it, and rebuilding geometry mid-verb is how an injection drops a frame
  // (AC-14).
  const CAPACITY = COUNT * 2;
  /**
   * The street plan, which every other thing in this scene is derived from.
   *
   * Buildings used to be scattered through an annulus at random angles with random
   * rotations. That is not a city, it is a handful of boxes thrown at a disc — and it
   * was the single cause of four separate complaints: there were no streets, because
   * there were no gaps for streets to be; nothing was well placed, because nothing was
   * placed at all; a rig dropped into the world landed inside a tower; and trees had
   * nowhere to stand.
   *
   * So the avenues come first. Everything downstream reads from `AVENUES` — the blocks
   * are what is left between them, the buildings sit inside blocks aligned to their
   * edges, the street texture is drawn from the same coordinates, and the plaza is one
   * block deliberately left empty for whatever the agent builds.
   *
   * Irregular spacing on purpose. An even grid reads as graph paper; a real plan has
   * long avenues and short cross streets, and the variation is most of what makes it
   * look surveyed rather than tiled.
   */
  const CITY_HALF = 1150;
  const AVENUES: number[] = [];
  for (let at = -CITY_HALF; at < CITY_HALF; ) {
    AVENUES.push(at);
    at += 86 + rand() * 104;
  }
  AVENUES.push(CITY_HALF);
  /** Half-width of the roadway. Buildings are inset from the avenue by this much. */
  const ROAD = 11;

  /** One block: the space between four avenues, minus the pavement. */
  interface Block {
    readonly x0: number; readonly x1: number;
    readonly z0: number; readonly z1: number;
  }
  const cityBlocks: Block[] = [];
  for (let i = 0; i < AVENUES.length - 1; i++) {
    for (let j = 0; j < AVENUES.length - 1; j++) {
      const x0 = AVENUES[i]! + ROAD, x1 = AVENUES[i + 1]! - ROAD;
      const z0 = AVENUES[j]! + ROAD, z1 = AVENUES[j + 1]! - ROAD;
      if (x1 - x0 < 26 || z1 - z0 < 26) continue;
      // The core of the map is left open, and it has to be *wider than the camera's
      // orbit*. At 120 it was not: the camera circles at 165, so the first grid put it
      // inside the city, looking down an avenue with two towers filling the frame. The
      // view this world is composed for is a skyline seen across open ground, so the
      // ground has to be there. 260 puts the nearest block a hundred units beyond the
      // orbit and turns the middle of the map into the plaza the rigs already assumed.
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      if (Math.hypot(cx, cz) < 260) continue;
      cityBlocks.push({ x0, x1, z0, z1 });
    }
  }
  // Nearest first, so the prefix that `skyline-shift` draws is the city around the
  // viewer rather than a random scatter of the whole map.
  cityBlocks.sort((a, b) =>
    Math.hypot((a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2) - Math.hypot((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2));

  const slots: Slot[] = [];
  for (let i = 0; i < CAPACITY; i++) {
    const block = cityBlocks[i % cityBlocks.length]!;
    const bw = block.x1 - block.x0, bd = block.z1 - block.z0;
    // A second pass over the same block puts a second building on it, so a block can
    // hold a tower and its low neighbour rather than one box centred in a plot.
    const lot = Math.floor(i / cityBlocks.length);
    const cols = bw > 90 ? 2 : 1, lotRows = bd > 90 ? 2 : 1;
    const col = lot % cols, row = Math.floor(lot / cols) % lotRows;

    const width = Math.min(46, (bw / cols) * (0.62 + rand() * 0.3));
    const depth = Math.min(46, (bd / lotRows) * (0.62 + rand() * 0.3));
    const x = block.x0 + (bw / cols) * (col + 0.5) + (rand() - 0.5) * 6;
    const z = block.z0 + (bd / lotRows) * (row + 0.5) + (rand() - 0.5) * 6;

    // Tall in the middle, low at the edges — which is what a downtown is, and it gives
    // the skyline a shape instead of a uniform field of towers.
    const fromCentre = Math.min(1, Math.hypot(x, z) / CITY_HALF);
    const ceiling = 340 * (1 - fromCentre * 0.72);
    const height = Math.max(26, 26 + rand() * rand() * ceiling);

    // The massing.
    //
    // Every building used to be one box scaled three ways, which is exactly the shape
    // the word "blocky" describes — and no amount of texture or rim light fixes a
    // silhouette. Real towers change as they rise, so these are built from tiers:
    // each one starts where the last is still going, sits in by a little, and stops
    // short of it. Four archetypes, chosen by a roll, because a city where every
    // building is assembled by the same rule reads as one building repeated.
    const boxes: Box[] = [];
    const shape = rand();
    if (shape < 0.3) {
      // Slab: one volume, with a mechanical cap. The plainest of them, and the reason
      // the skyline still has flat shoulders to set the spires against.
      boxes.push({ dx: 0, dz: 0, w: 1, d: 1, y0: 0, h: 1 });
      boxes.push({ dx: 0, dz: 0, w: 0.52, d: 0.52, y0: 1, h: 0.035 });
    } else if (shape < 0.68) {
      // Setback tower: three tiers stepping in, the profile of almost every pre-war
      // high-rise and the one that most reads as "city" from a distance.
      const t1 = 0.42 + rand() * 0.2;
      const t2 = t1 + (0.28 + rand() * 0.16);
      boxes.push({ dx: 0, dz: 0, w: 1, d: 1, y0: 0, h: t1 });
      boxes.push({ dx: 0, dz: 0, w: 0.82, d: 0.82, y0: t1, h: t2 - t1 });
      boxes.push({ dx: 0, dz: 0, w: 0.62, d: 0.62, y0: t2, h: 1 - t2 });
      boxes.push({ dx: 0, dz: 0, w: 0.3, d: 0.3, y0: 1, h: 0.05 + rand() * 0.04 });
    } else if (shape < 0.88) {
      // Tapered: four short steps. Reads as a spire from far away and as detail near.
      let y = 0;
      for (let t = 0; t < 4; t++) {
        const next = y + (1 - y) * (0.42 + rand() * 0.22);
        const k = 1 - t * 0.17;
        boxes.push({ dx: 0, dz: 0, w: k, d: k, y0: y, h: next - y });
        y = next;
      }
      boxes.push({ dx: 0, dz: 0, w: 0.34, d: 0.34, y0: y, h: 1 - y });
    } else {
      // Shouldered: a low wing against a tall shaft, offset to one side. This is the
      // one that breaks the rule that a building is symmetrical about its own centre.
      const side = rand() < 0.5 ? -1 : 1;
      boxes.push({ dx: 0, dz: 0, w: 0.66, d: 1, y0: 0, h: 1 });
      boxes.push({ dx: side * 0.62, dz: 0, w: 0.58, d: 0.78, y0: 0, h: 0.34 + rand() * 0.22 });
      boxes.push({ dx: 0, dz: 0, w: 0.26, d: 0.4, y0: 1, h: 0.04 });
    }
    /**
     * Rooftop clutter: water tanks, stair houses, plant.
     *
     * What separates a skyline that was built from one that was extruded is what sits on
     * top of it. Every roof here was a clean rectangle — which no roof is: real ones
     * carry tanks, lift machinery, a stair house, a run of ducting, and from street
     * level those read as a broken silhouette against the sky rather than as detail.
     *
     * Cheap, because it is the same instanced mesh: two or three more boxes on a
     * building that already costs two to five. Offset off-centre and sized small, since
     * a tank in the middle of the roof at a third of its width is a penthouse.
     */
    const roofBits = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < roofBits; k++) {
      const w = 0.1 + rand() * 0.17;
      boxes.push({
        dx: (rand() - 0.5) * 0.52,
        dz: (rand() - 0.5) * 0.52,
        w, d: w * (0.7 + rand() * 0.7),
        y0: 1,
        // Squat, mostly. The occasional tall one is a stair house or a tank on legs.
        h: rand() < 0.22 ? 0.05 + rand() * 0.05 : 0.018 + rand() * 0.022,
      });
    }

    // A mast on the tall ones only. Every tower wearing an antenna is as uniform as
    // none of them wearing one.
    const tall = height > 150 && rand() < 0.55;
    if (tall) boxes.push({ dx: 0, dz: 0, w: 0.055, d: 0.055, y0: 1, h: 0.16 + rand() * 0.12 });

    // Lit windows, placed on the two faces that face the origin so the camera sees
    // them. The first attempt scattered them with sign flips that cancelled out and
    // put most of them inside the geometry, where they are invisible.
    const windows: { dx: number; dz: number; t: number }[] = [];
    // Placed on the face that looks toward the middle of the map, which is where the
    // camera is. The old version derived this from the building's own angle around a
    // ring; on a street grid there is no such angle, so it comes from the direction back
    // to the origin instead.
    const toCentre = Math.hypot(x, z) || 1;
    const nx = x / toCentre, nz = z / toCentre;
    const floors = Math.max(1, Math.floor(height / 22));
    for (let r = 0; r < floors; r++) {
      for (let k = 0; k < 3; k++) {
        if (rand() > 0.3) continue;
        const lateral = (k - 1) * width * 0.3;
        windows.push({
          dx: -nx * (depth / 2 + 1.2) - nz * lateral,
          dz: -nz * (depth / 2 + 1.2) + nx * lateral,
          t: (14 + r * 22 + rand() * 6) / height,
        });
      }
    }

    slots.push({
      x, z, width, depth, height,
      // Square to the street. A random rotation is the other half of why the old city
      // read as scattered: buildings meet an avenue along their face, always, and a
      // block of them at eleven different angles is a collision, not a neighbourhood.
      // The quarter-turns keep the facade variety without breaking the alignment.
      rotation: (Math.floor(rand() * 4) * Math.PI) / 2,
      windows, boxes,
      // Above the mast if there is one, on the roof if not. Only on what is tall
      // enough that a real one would be required to carry it.
      beacon: height > 150 ? (tall ? 1.3 : 1.02) : null,
    });
  }

  /**
   * Street light: a carpet of small warm points on the ground between the towers.
   *
   * The lower third of the frame was an empty grey plane, and it made the city look
   * like a model standing on a table — every tower had detail and the thing they all
   * stood on had none, so the eye read the ground as the backdrop it was. A night city
   * seen from above the rooftops is mostly this: lamps, windows at street level,
   * headlights, none of them individually legible and all of them together the reason
   * the ground glows instead of sitting there.
   *
   * Scattered rather than gridded. A grid at this density moires against the pixel grid
   * as the camera turns, and a real street plan is not visible from inside it anyway.
   */
  const LAMPS = 2600;
  const lampGeo = new BufferGeometry();
  const lampPos = new Float32Array(LAMPS * 3);
  for (let i = 0; i < LAMPS; i++) {
    const a = rand() * Math.PI * 2;
    // Biased outward by the square root so the density is even over the area rather
    // than piling up around the camera, which is where it would be most obviously fake.
    const r = 90 + Math.sqrt(rand()) * 1500;
    lampPos[i * 3] = Math.cos(a) * r;
    lampPos[i * 3 + 1] = 1.5 + rand() * 3;
    lampPos[i * 3 + 2] = Math.sin(a) * r;
  }
  lampGeo.setAttribute('position', new BufferAttribute(lampPos, 3));
  const lampMat = new PointsMaterial({
    size: 2.6, color: new Color(1, 0.63, 0.3), transparent: true, opacity: 0.55,
    blending: AdditiveBlending, depthWrite: false,
  });
  const lamps = new Points(lampGeo, lampMat);
  lamps.frustumCulled = false;
  scene.add(lamps);

  /**
   * The streets, as a lit grid laid over the ground.
   *
   * Without them the city stands on nothing. The ground is a near-black plane and the
   * towers simply stop at the bottom of the frame, which reads as a skyline pasted onto
   * a dark background rather than as a place — and it is the first thing anyone sees,
   * before a word of the interface has been read.
   *
   * A night city seen from above is mostly this: dark blocks with glowing lines between
   * them. It is a separate additive mesh rather than an emissive map on the ground,
   * because the ground's `emissive` channel belongs to the time of day — `daylight`
   * drives it, and `ground-tint` blends from the authored colour (AC-12). Adding a map
   * there would have put the streets under two owners.
   *
   * The grid is deliberately irregular. Perfectly even blocks read as graph paper; real
   * cities have avenues that run wider and further than the streets between them.
   */
  const STREET_TEX = 2048;
  const STREET_SPAN = CITY_HALF * 2 + 160;
  const streets = document.createElement('canvas');
  streets.width = streets.height = STREET_TEX;
  const sx = streets.getContext('2d')!;
  sx.fillStyle = '#05060a';
  sx.fillRect(0, 0, STREET_TEX, STREET_TEX);

  /** World coordinate to texture pixel. The plane and the plan share one mapping. */
  const toTex = (world: number): number => ((world + STREET_SPAN / 2) / STREET_SPAN) * STREET_TEX;
  const texPerUnit = STREET_TEX / STREET_SPAN;

  // Drawn from `AVENUES`, which is what makes these *streets* rather than a pattern.
  // The previous grid was an independent set of lines at an unrelated spacing, laid over
  // buildings that were scattered at random — so it crossed through towers and stopped
  // in the middle of blocks, and read as a texture because that is all it was. These
  // lines land in the gaps because the gaps were cut from the same numbers.
  for (const axis of [0, 1]) {
    for (const avenue of AVENUES) {
      const at = toTex(avenue);
      const w = ROAD * texPerUnit;
      const g = sx.createLinearGradient(
        axis ? 0 : at - w, axis ? at - w : 0,
        axis ? 0 : at + w, axis ? at + w : 0,
      );
      // Asphalt in the middle, lit at the kerbs. A road that is brightest along its
      // centreline reads as a strip light; a real one is lit from its edges.
      g.addColorStop(0, 'rgba(255,166,92,0.55)');
      g.addColorStop(0.28, 'rgba(96,86,78,0.5)');
      g.addColorStop(0.5, 'rgba(62,58,56,0.55)');
      g.addColorStop(0.72, 'rgba(96,86,78,0.5)');
      g.addColorStop(1, 'rgba(255,166,92,0.55)');
      sx.fillStyle = g;
      if (axis) sx.fillRect(0, at - w, STREET_TEX, w * 2);
      else sx.fillRect(at - w, 0, w * 2, STREET_TEX);
    }
  }

  // The lane markings: a dashed centreline down each avenue. Small, and the thing that
  // makes a strip of asphalt read as a road rather than as a grey band.
  sx.fillStyle = 'rgba(228,214,176,0.5)';
  for (const axis of [0, 1]) {
    for (const avenue of AVENUES) {
      const at = toTex(avenue);
      const dash = 9 * texPerUnit, gap = 13 * texPerUnit, thick = Math.max(1, 0.7 * texPerUnit);
      for (let along = 0; along < STREET_TEX; along += dash + gap) {
        if (axis) sx.fillRect(along, at - thick / 2, dash, thick);
        else sx.fillRect(at - thick / 2, along, thick, dash);
      }
    }
  }

  // Faded at the rim, so the plane does not draw its own edge across the skyline.
  sx.globalCompositeOperation = 'destination-in';
  const falloff = sx.createRadialGradient(
    STREET_TEX / 2, STREET_TEX / 2, STREET_TEX * 0.2,
    STREET_TEX / 2, STREET_TEX / 2, STREET_TEX * 0.5,
  );
  falloff.addColorStop(0, 'rgba(0,0,0,1)');
  falloff.addColorStop(0.8, 'rgba(0,0,0,0.92)');
  falloff.addColorStop(1, 'rgba(0,0,0,0)');
  sx.fillStyle = falloff;
  sx.fillRect(0, 0, STREET_TEX, STREET_TEX);
  sx.globalCompositeOperation = 'source-over';

  const streetMap = new CanvasTexture(streets);
  streetMap.wrapS = streetMap.wrapT = ClampToEdgeWrapping;
  streetMap.colorSpace = SRGBColorSpace;
  streetMap.generateMipmaps = true;
  streetMap.minFilter = LinearMipmapLinearFilter;
  streetMap.anisotropy = 16;
  const streetMat = new MeshBasicMaterial({
    map: streetMap, transparent: true, opacity: 0.95,
    blending: AdditiveBlending, depthWrite: false, fog: true,
  });
  // Sized to the plan, not to a number picked by eye: the texture covers the city
  // exactly once, so a pixel in it is a fixed number of world units and the lane
  // markings stay the same size wherever you stand.
  const streetMesh = new Mesh(new PlaneGeometry(STREET_SPAN, STREET_SPAN), streetMat);
  streetMesh.rotation.x = -Math.PI / 2;
  streetMesh.position.y = 0.4;
  scene.add(streetMesh);

  /**
   * Street trees, along the avenues the plan already knows about.
   *
   * A city with no planting is a rendering of a city. They also carry the only green in
   * a scene that is otherwise blue sky, orange sodium and near-black stone — and one
   * colour that belongs to nothing else is what stops a palette reading as a filter.
   *
   * Placed from `AVENUES` like everything else, set back to the kerb, and skipped near
   * the middle so the plaza stays open for whatever the agent builds there. Two instanced
   * draws for the whole city: trunks and canopies.
   */
  const TREE_CAP = 900;
  const trunkGeo = new CylinderGeometry(0.55, 0.8, 9, 6);
  const trunkMat = new MeshStandardMaterial({ color: new Color(0.055, 0.042, 0.031), roughness: 0.95 });
  const trunks = new InstancedMesh(trunkGeo, trunkMat, TREE_CAP);
  const canopyGeo = new SphereGeometry(1, 7, 5);
  const canopyMat = new MeshStandardMaterial({
    color: new Color(0.055, 0.105, 0.052), roughness: 0.88,
    emissive: new Color(0.013, 0.030, 0.014), emissiveIntensity: 1,
  });
  const canopies = new InstancedMesh(canopyGeo, canopyMat, TREE_CAP);
  trunks.castShadow = canopies.castShadow = true;
  canopies.receiveShadow = true;

  {
    const tm = new Matrix4(), tq = new Quaternion(), tp = new Vector3(), ts = new Vector3();
    let n = 0;
    for (const avenue of AVENUES) {
      for (const side of [-1, 1]) {
        const offset = avenue + side * (ROAD + 3.4);
        for (let along = -CITY_HALF; along < CITY_HALF && n < TREE_CAP - 1; along += 26 + rand() * 16) {
          // Two rows per avenue, one along each axis, so a corner gets trees on both.
          for (const axis of [0, 1]) {
            if (n >= TREE_CAP - 1) break;
            const x = axis ? along : offset;
            const z = axis ? offset : along;
            const r = Math.hypot(x, z);
            // Not in the plaza and not out past the fog.
            if (r < 235 || r > CITY_HALF) continue;
            if (rand() > 0.62) continue;
            const scale = 0.82 + rand() * 0.7;
            tp.set(x, 4.5 * scale, z);
            ts.set(scale, scale, scale);
            trunks.setMatrixAt(n, tm.compose(tp, tq, ts));
            tp.set(x, (9 + 4.6) * scale, z);
            // Squashed a little and turned, so a row of them is not one tree repeated.
            ts.set(5.4 * scale, 6.4 * scale * (0.8 + rand() * 0.4), 5.4 * scale);
            tq.setFromAxisAngle(new Vector3(0, 1, 0), rand() * Math.PI);
            canopies.setMatrixAt(n, tm.compose(tp, tq, ts));
            tq.identity();
            n += 1;
          }
        }
      }
    }
    trunks.count = canopies.count = n;
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
  }
  scene.add(trunks, canopies);

  // A node material rather than a plain standard one, for one reason: the rim.
  //
  // Two faces of a box under a single directional light are two flat values meeting at
  // a hard corner, and at night the near-black albedo collapses both of them into the
  // same silhouette — which is what made the city read as blocks. The fresnel term
  // below lights only the grazing edge, so every building gets a lit contour against
  // whatever is behind it and the shapes separate. Node materials run on both the
  // WebGPU and the WebGL2 backend, so this costs AC-03 nothing.
  const rimTint = uniform(new Color(0.3, 0.44, 0.72));
  const rimStrength = uniform(0.7);
  const blockMaterial = new MeshStandardNodeMaterial({
    color: new Color(0.017, 0.022, 0.033), roughness: 0.82, metalness: 0.25,
  });
  // Written to `emissiveNode` rather than mixed into the lighting: the rim is a
  // stylistic edge light with no source in the world, and running it through the
  // shading model would make it answer to the key's intensity, which is exactly the
  // frame where it is least wanted (noon) and most wanted (midnight).
  // The exponent is what keeps it a contour: at 1 the whole face lifts and the city
  // turns grey.
  /**
   * A facade, drawn once into a canvas and worn by every building.
   *
   * The research on why realtime web 3D reads as cheap is blunt about this: the secret
   * is not in the geometry, it is in the textures. A box with a rim light is still a
   * box; a box with a grid of windows is a building, and the difference costs one
   * 256x512 canvas and no extra draw calls.
   *
   * Deliberately irregular. A perfect grid of identical lit squares reads as wallpaper,
   * because real buildings have floors where nobody is home. Roughly a third are lit,
   * a few are warmer than the rest, and the columns are not perfectly aligned.
   */
  const facade = document.createElement('canvas');
  facade.width = 512;
  facade.height = 1024;
  const fx = facade.getContext('2d')!;
  fx.fillStyle = '#05070c';
  fx.fillRect(0, 0, 512, 1024);

  const cols = 18, rows = 40;
  const cw = 512 / cols, ch = 1024 / rows;

  // Structure before glass. A facade is not a field of lit rectangles floating in
  // black — it is a frame with glass in it, and the frame is what the eye reads as
  // construction. Mullions run the full height between window columns; floor slabs run
  // the full width between them. Both are barely lighter than the wall, which is all
  // they need to be: at this distance they are the difference between a building and
  // a QR code.
  fx.fillStyle = 'rgba(150,168,198,0.035)';
  for (let c = 0; c <= cols; c++) fx.fillRect(c * cw - 1, 0, 2, 1024);
  for (let r = 0; r <= rows; r++) fx.fillRect(0, r * ch - 1, 512, 2);

  for (let r = 0; r < rows; r++) {
    // Occupancy by floor, not by window. Offices empty a floor at a time, so lighting
    // each window independently is the tell — it produces a static of lit squares no
    // real building has ever shown. A few floors are fully lit (lobby, mechanical,
    // someone's very bad night) and most are empty.
    const roll = rand();
    const occupancy = roll > 0.86 ? 0.92 : roll > 0.62 ? 0.34 : roll > 0.34 ? 0.12 : 0;
    if (occupancy === 0) continue;
    // One temperature per floor, with drift. A building lit at one colour is
    // generated; a building lit at twenty is a Christmas tree. Floors share bulbs.
    const floorWarm = rand();
    for (let c = 0; c < cols; c++) {
      if (rand() > occupancy) continue;
      const warm = floorWarm * 0.72 + rand() * 0.28;
      fx.fillStyle = warm > 0.74 ? `rgba(255,206,142,${0.55 + rand() * 0.4})`
        : warm > 0.3 ? `rgba(240,231,210,${0.4 + rand() * 0.38})`
        : `rgba(168,194,228,${0.3 + rand() * 0.3})`;
      // Inset inside its cell so the mullion and the slab both survive, and the glass
      // reads as glass held in something rather than as a tile.
      fx.fillRect(c * cw + 2.5, r * ch + 2, cw - 5, ch - 4.5);
    }
  }

  const facadeMap = new CanvasTexture(facade);
  facadeMap.wrapS = facadeMap.wrapT = RepeatWrapping;
  facadeMap.colorSpace = SRGBColorSpace;
  // Mipmaps and anisotropy, or the windows tear themselves apart.
  //
  // A facade this fine is mostly high-frequency detail, and a tower fifty units wide
  // covering two hundred pixels of screen asks for one texel out of every four. Without
  // a mip chain the sampler picks whichever it lands on, and the result was not "small
  // windows" but a shimmering herringbone — the towers looked like untuned television.
  // Anisotropy is the other half: these surfaces are almost always seen at a grazing
  // angle, where a trilinear sample blurs along the wrong axis and the floors smear
  // into stripes.
  facadeMap.generateMipmaps = true;
  facadeMap.minFilter = LinearMipmapLinearFilter;
  facadeMap.anisotropy = 16;
  facadeMap.needsUpdate = true;
  // Combined, not assigned. `emissiveNode` *replaces* the emissive chain, so setting
  // the rim light there silently discarded `emissiveMap` — the facade was uploaded,
  // bound, and never sampled. The windows were there the whole time and nothing drew
  // them, which is the same class of bug as a binding reading a key nobody writes.
  /**
   * The facade is mapped in world units, not in the box's own UVs.
   *
   * A cube's UVs run 0..1 across a face whatever that face measures, so one tile of
   * windows stretched to fit every building — and the buildings here are between
   * sixteen and forty-six units wide. The near towers wore windows three times the size
   * of the far ones, which is the single most reliable way to make architecture read as
   * Lego: in a real city the window is the constant and the building is the variable.
   *
   * So U comes from world x or z depending on which way the face points, V comes from
   * world height, and a floor is a floor and a pane is a pane everywhere in the scene.
   * The `oneMinus(up)` mask is what keeps roofs out of it: a vertical projection has
   * nothing to say about a horizontal surface, and without the mask every rooftop wore
   * a smear of stretched glass.
   */
  const nAbs = abs(normalWorld);
  // 36 world units per tile across, 140 up. With 18 columns and 40 rows in the tile
  // that is a window every two units and a floor every three and a half — and, at the
  // sizes the city is authored in, roughly one tile per building. Both halves of that
  // matter: the first makes a window a fixed thing, and the second keeps a tile's worth
  // of variety attached to one building. Tiling a facade eight times over averages the
  // lit and dark floors back into a uniform glow, which is how the first attempt turned
  // every tower into beige corduroy.
  const facadeUv = vec2(
    positionWorld.x.mul(nAbs.z).add(positionWorld.z.mul(nAbs.x)).mul(1 / 36),
    positionWorld.y.mul(1 / 140),
  );
  const facadeGlow = texture(facadeMap, facadeUv)
    .rgb
    .mul(nAbs.y.oneMinus().clamp())
    .mul(0.62);
  /**
   * The warmth street light throws up the first few floors of a building.
   *
   * It belongs in the shader and not in the texture, which is where it started: a
   * gradient painted along the bottom of the tile tiles with it, so every tower wore a
   * warm band at each repeat — a sunset stripe forty floors up.
   *
   * Twelve units of falloff, not thirty-four. The first pass reached a hundred units up
   * at a tenth strength, which over a frame this tall is not a glow at the kerb, it is
   * an orange bath: the city looked lit from below by something enormous. A street lamp
   * lights the lobby and the two floors above it and then gives up.
   */
  const streetWarmth = vec3(1, 0.6, 0.3).mul(
    positionWorld.y.max(0).mul(-1 / 12).exp().mul(0.3).mul(nAbs.y.oneMinus().clamp()),
  );
  blockMaterial.emissiveNode = rimTint
    .mul(rimStrength)
    .mul(normalView.dot(positionViewDirection).clamp().oneMinus().pow(4.5))
    .add(facadeGlow)
    .add(streetWarmth);

  // One instance per *volume*, not per building, so the draw range is still a prefix
  // sum and `skyline-shift` still costs a count change rather than a rebuild (AC-14).
  const boxStart: number[] = [0];
  for (const slot of slots) boxStart.push(boxStart[boxStart.length - 1]! + slot.boxes.length);
  const blocks = new InstancedMesh(
    new BoxGeometry(1, 1, 1), blockMaterial, boxStart[boxStart.length - 1]!,
  );

  /**
   * A different building material per building.
   *
   * Eighteen hundred volumes shared one colour and one roughness, which is a decision
   * nobody made — it is what you get when a city is one `InstancedMesh` and nothing says
   * otherwise. Real blocks are concrete next to glass next to brick, and the difference
   * between them is most of what stops a skyline reading as one extruded object.
   *
   * Tinted per *building*, not per volume: a tower whose setback is a different colour
   * from its own shaft is two buildings stacked, which is worse than one flat one. The
   * seed is the slot index, so it is the same city on every load — a screenshot stays a
   * fact (see `rng`).
   */
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const roll = rand();
    // Three families, in the proportions a city actually has: mostly dark stone, some
    // colder glass, a few warmer pre-war blocks.
    const tint = roll > 0.74
      ? new Color(0.021, 0.030, 0.048)   // glass — bluer, and it catches the moon
      : roll > 0.58
        ? new Color(0.030, 0.025, 0.021) // brick — warmer, reads brown against the rest
        : new Color(0.017, 0.022, 0.033); // stone — the authored value
    // A little brightness spread within the family, so even two stone towers differ.
    tint.multiplyScalar(0.72 + rand() * 0.62);
    for (let b = boxStart[i]!; b < boxStart[i + 1]!; b++) blocks.setColorAt(b, tint);
  }
  if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;

  // The city casts and receives. Both, deliberately: a tower that casts without
  // receiving is lit on the face its neighbour should be darkening.
  blocks.castShadow = true;
  blocks.receiveShadow = true;
  scene.add(blocks);

  /**
   * Aviation beacons — the red lights on the masts.
   *
   * A handful of pixels, and one of the strongest single cues that a skyline is a
   * photograph of somewhere rather than a diagram of somewhere. They blink together
   * here rather than independently, which is wrong and reads right: independent phases
   * at this distance look like noise.
   */
  const beacons = slots.filter((slot) => slot.beacon !== null);
  const beaconGeo = new BufferGeometry();
  beaconGeo.setAttribute('position', new BufferAttribute(new Float32Array(beacons.length * 3), 3));
  const beaconMat = new PointsMaterial({
    size: 4.6, color: new Color(1, 0.16, 0.12), transparent: true, opacity: 0.9,
    blending: AdditiveBlending, depthWrite: false,
  });
  const beaconPoints = new Points(beaconGeo, beaconMat);
  beaconPoints.frustumCulled = false;
  scene.add(beaconPoints);

  // One window buffer for every slot the mesh can draw, filled in slot order. Visible
  // buildings are always a prefix of `slots`, so the draw range is a prefix sum.
  const windowStart: number[] = [0];
  for (const slot of slots) windowStart.push(windowStart[windowStart.length - 1]! + slot.windows.length);
  const winGeo = new BufferGeometry();
  winGeo.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(windowStart[windowStart.length - 1]! * 3), 3),
  );
  const winMat = new PointsMaterial({
    size: 3.4, color: new Color(1, 0.72, 0.36).multiplyScalar(WINDOW_GAIN),
    transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false,
  });
  const winPoints = new Points(winGeo, winMat);
  winPoints.frustumCulled = false;
  scene.add(winPoints);

  const m = new Matrix4(), q = new Quaternion(), pos = new Vector3(), scl = new Vector3();
  const axisY = new Vector3(0, 1, 0);
  const offset = new Vector3();

  function drawSkyline(heightScale: number, visible: number): void {
    const shown = Math.max(0, Math.min(CAPACITY, Math.round(visible)));
    const attr = winGeo.getAttribute('position') as BufferAttribute;
    const out = attr.array as Float32Array;
    const beaconOut = (beaconGeo.getAttribute('position') as BufferAttribute).array as Float32Array;
    let lit = 0;
    for (let i = 0; i < shown; i++) {
      const slot = slots[i]!;
      const height = slot.height * heightScale;
      q.setFromAxisAngle(axisY, slot.rotation);
      for (let b = 0; b < slot.boxes.length; b++) {
        const box = slot.boxes[b]!;
        // The offset turns with the building. A wing placed in world axes would swing
        // out of its own tower the moment the tower was rotated.
        offset.set(box.dx * slot.width, 0, box.dz * slot.depth).applyQuaternion(q);
        pos.set(slot.x + offset.x, height * (box.y0 + box.h / 2), slot.z + offset.z);
        scl.set(slot.width * box.w, height * box.h, slot.depth * box.d);
        blocks.setMatrixAt(boxStart[i]! + b, m.compose(pos, q, scl));
      }
      if (slot.beacon !== null) {
        beaconOut[lit * 3] = slot.x;
        beaconOut[lit * 3 + 1] = height * slot.beacon;
        beaconOut[lit * 3 + 2] = slot.z;
        lit++;
      }
      for (let w = 0; w < slot.windows.length; w++) {
        const win = slot.windows[w]!;
        const o = (windowStart[i]! + w) * 3;
        out[o] = slot.x + win.dx;
        out[o + 1] = win.t * height;
        out[o + 2] = slot.z + win.dz;
      }
    }
    blocks.count = boxStart[shown]!;
    blocks.instanceMatrix.needsUpdate = true;
    beaconGeo.setDrawRange(0, lit);
    (beaconGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    winGeo.setDrawRange(0, windowStart[shown]!);
    attr.needsUpdate = true;
  }

  drawSkyline(1, COUNT);

  const skyline: SkylineHandle = {
    mesh: blocks,
    baseCount: COUNT,
    maxCount: CAPACITY,
    apply: drawSkyline,
    reset: () => drawSkyline(1, COUNT),
  };

  // ── Light ──────────────────────────────────────────────────────────────────
  // 2.15 against an ambient of 0.2 — a ratio of about eleven to one, where it used to be
  // a little over two.
  //
  // That ratio is why the city looked flat, and it is why the shadows that were just
  // switched on could not be seen: a shadow is the absence of the key, and if the key is
  // only twice the fill there is nowhere for it to darken to. Moonlight is a hard source
  // with a very dark sky behind it; the old numbers were lighting a room, not a night.
  const key = new DirectionalLight(new Color(0.68, 0.78, 1), 2.15);
  /**
   * The moon casts.
   *
   * An orthographic frustum wide enough for the authored city and no wider: every unit
   * of frustum is spread across the same 2048 texels, so a box sized to be safe is a box
   * that throws resolution away. 1300 covers the ring the buildings actually occupy.
   *
   * The bias numbers are the ones that took looking rather than reasoning. Without
   * `normalBias` the facades acne — a surface at a grazing angle to the light samples
   * its own depth and shadows itself in stripes — and on a city of flat faces under a
   * low moon, almost every face is at a grazing angle.
   */
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -1300;
  key.shadow.camera.right = 1300;
  key.shadow.camera.top = 1300;
  key.shadow.camera.bottom = -1300;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 4200;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 1.4;
  key.shadow.radius = 3;
  key.position.copy(moon.position);
  scene.add(key);
  const ambient = new AmbientLight(new Color(0.16, 0.22, 0.38), 0.2);
  scene.add(ambient);

  // The authored sky, captured from the objects themselves at the one moment nothing
  // has had a chance to change them. A binding that read "the current sky" would
  // cross-fade from whatever the previous verb left behind and never find its way
  // home on dispose() (AC-12) - the same argument `ground` above makes.
  const skyFog = scene.fog as Fog;
  let windowGlow = 1;
  const authoredSky: SkyState = {
    horizon: HORIZON.clone(),
    zenith: ZENITH.clone(),
    discPosition: moon.position.clone(),
    // The un-gained colours: `DISC_GAIN` and `HALO_GAIN` are a display decision that
    // `applySky` re-applies, so what a preset states is what it means.
    discColor: DISC_COLOR.clone(),
    discRadius: DISC_RADIUS,
    haloColor: HALO_COLOR.clone(),
    haloOpacity: 0.16,
    starOpacity: starMat.opacity,
    keyColor: key.color.clone(),
    keyIntensity: key.intensity,
    ambientColor: ambient.color.clone(),
    ambientIntensity: ambient.intensity,
    fogColor: skyFog.color.clone(),
    groundEmissive: groundMaterial.emissive.clone(),
    windowGlow: 1,
    rimColor: new Color(0.3, 0.44, 0.72),
    rimIntensity: 0.7,
  };

  function applySky(next: SkyState): void {
    for (let i = 0; i < skyBlend.length; i++) {
      c.copy(next.horizon).lerp(next.zenith, skyBlend[i]!);
      skyCol[i * 3] = c.r; skyCol[i * 3 + 1] = c.g; skyCol[i * 3 + 2] = c.b;
    }
    skyColorAttr.needsUpdate = true;

    moon.position.copy(next.discPosition);
    halo.position.copy(next.discPosition);
    const s = next.discRadius / DISC_RADIUS;
    moon.scale.setScalar(s);
    halo.scale.setScalar(s);
    moonMat.color.copy(next.discColor).multiplyScalar(DISC_GAIN);
    haloMat.color.copy(next.haloColor);
    haloMat.opacity = next.haloOpacity * HALO_GAIN;
    starMat.opacity = next.starOpacity;
    // Switched off rather than merely transparent: an additive point at opacity 0.001
    // still costs a draw call for 900 vertices nobody can see (R-9).
    starField.visible = next.starOpacity > 0.005;
    // The light and the disc move together, always. A key that outlives the thing it
    // is supposed to be coming from is the arbitrary global tint this scene was built
    // to avoid.
    key.position.copy(next.discPosition);
    key.color.copy(next.keyColor);
    key.intensity = next.keyIntensity;
    ambient.color.copy(next.ambientColor);
    ambient.intensity = next.ambientIntensity;
    skyFog.color.copy(next.fogColor);
    groundMaterial.emissive.copy(next.groundEmissive);
    windowGlow = next.windowGlow;
    rimTint.value.copy(next.rimColor);
    rimStrength.value = next.rimIntensity;
  }

  const sky: SkyHandle = {
    authored: authoredSky,
    apply: applySky,
    reset: () => applySky(authoredSky),
  };

  /**
   * Composition, which is what was actually wrong.
   *
   * The camera sat at eye level in the middle of a uniform ring of buildings, orbiting
   * slowly and looking at nothing in particular. Research on why amateur scenes read
   * as amateur is blunt about both halves: competing focal points split attention so
   * every frame needs one primary subject, and everything shot at eye level with
   * centred framing produces flat visual storytelling.
   *
   * So: a low camera looking *up* — the angle that makes architecture feel tall — and
   * a look-at target biased off-centre so the moon lands near a thirds intersection
   * rather than dead middle. No new geometry, no new shader.
   */
  const camera = new PerspectiveCamera(54, 1, 0.5, 4000);
  let dolly = 165;

  /**
   * What the viewer has asked for, on top of the automatic orbit.
   *
   * The camera was on rails: a slow orbit, no controls, and the reasoning was that the
   * motion makes an injected change read as an addition to a living world rather than a
   * page that swapped itself out. That is true and it was not the whole truth — a 3D
   * world you cannot look around is not a world, and the first person to try to inspect
   * something the agent had just built could not.
   *
   * So the orbit is a *default*, not a track. Dragging adds to it, the wheel pushes in
   * and out, and after a few seconds of stillness the offsets ease back to zero and the
   * automatic shot resumes. Nothing is taken away: the idle behaviour is byte-identical
   * to what it was, which is also why the frame-budget and silhouette tests still
   * measure what they were written to measure.
   */
  const view = { yaw: 0, pitch: 0, zoom: 1, lastInput: -Infinity };
  /** Seconds of stillness before the shot takes itself back. */
  const RELEASE_AFTER = 4;
  const MIN_PITCH = -0.35;
  const MAX_PITCH = 0.85;

  function grabInput(el: HTMLElement): () => void {
    let dragging = false;
    let px = 0, py = 0;

    const down = (e: PointerEvent): void => {
      // Only the canvas itself, and never through the prompt or the panel.
      if (e.button !== 0) return;
      dragging = true; px = e.clientX; py = e.clientY;
      view.lastInput = performance.now() / 1000;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent): void => {
      if (!dragging) return;
      view.yaw -= (e.clientX - px) * 0.0045;
      view.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, view.pitch + (e.clientY - py) * 0.0032));
      px = e.clientX; py = e.clientY;
      view.lastInput = performance.now() / 1000;
    };
    const up = (e: PointerEvent): void => {
      dragging = false;
      el.releasePointerCapture?.(e.pointerId);
      el.style.cursor = 'grab';
      view.lastInput = performance.now() / 1000;
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      // Multiplicative, so a step feels the same close in as far out.
      view.zoom = Math.max(0.28, Math.min(2.4, view.zoom * Math.exp(e.deltaY * 0.0012)));
      view.lastInput = performance.now() / 1000;
    };

    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }
  const aim = new Vector3();
  const subject = new Vector3();
  let framing = 0;

  (scene.userData as Record<string, unknown>)[HANDLES_KEY] = { skyline, ground, sky } satisfies SceneHandles;

  return {
    scene,
    camera,
    skyline,
    ground,
    sky,
    /**
     * How much taller the world has become than it was authored, 0..1. The app feeds
     * this from world state; the scene stays renderer-only and knows nothing about
     * primitives or contracts.
     */
    setFraming(v: number) { framing = Math.max(0, Math.min(1, v)); },
    controls: grabInput,
    resize(w, h) {
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
    update(elapsed, focus) {
      // A slow orbit, low to the ground so the skyline crosses the moon. Motion in the
      // base scene is what makes an injected change read as an addition to a living
      // world rather than a page that swapped itself out.
      const a = elapsed * 0.021;
      // The frame reframes itself. When the world grows the camera pulls back and up,
      // because a world that can be reshaped needs a viewpoint that survives being
      // reshaped -- otherwise the first structural verb puts the camera inside a wall.
      // Eased, so the move reads as the world settling rather than a cut.
      // A rig pulls the camera in; the city pushes it out.
      //
      // A walking figure is about forty units tall in a city of three-hundred-unit
      // towers, so from the default distance it is roughly one percent of the frame —
      // present, verifiable, and not what anyone asked to look at. When someone says
      // "un perro con una persona paseando", the subject of the picture is the dog and
      // the person, and a camera that keeps framing the skyline is answering a
      // different request.
      // Framed by the subject's own size. `radius / tan(halfFov)` is the distance at
      // which a sphere of that radius exactly fills the frame; 3.2x that leaves it about
      // a third of the height with the city still behind it — which is the shot, because
      // a figure alone against black is not why anyone asked for a figure in a city.
      const want = focus
        // 2.4x the exact-fit distance rather than 3.2x: the subject fills about half the
        // frame height instead of a third, which is the difference between a figure you
        // can see and one you have to be told is there.
        ? Math.max(58, Math.min(300, (focus[3] / Math.tan((camera.fov * Math.PI) / 360)) * 2.4))
        : 150 + framing * 130;
      dolly += (want - dolly) * 0.02;
      // Low, and looking up. 12 units is street level against 300-unit towers, which
      // is the whole point: at 26 the camera was level with nothing and taller than
      // the low-rises, so the skyline read as a model on a table.
      // Lower than the shortest tower, which is the whole difference between standing
      // in a city and hovering over one.
      // The viewer's offsets, released back to zero after a few seconds of stillness so
      // the automatic shot resumes rather than leaving the frame wherever it was dropped.
      if (elapsed - view.lastInput > RELEASE_AFTER) {
        view.yaw *= 0.985; view.pitch *= 0.985; view.zoom += (1 - view.zoom) * 0.015;
      }
      const r = dolly * view.zoom;
      const ay = a + view.yaw;
      camera.position.set(
        Math.sin(ay) * r,
        15 + r * 0.06 + Math.sin(elapsed * 0.09) * 2.5 + view.pitch * r * 0.9,
        Math.cos(ay) * r,
      );
      // Biased off-centre, and lowered from 78 so the horizon is inside the frame.
      //
      // At 78 the camera pitched up about 32 degrees with a 54-degree field, so the
      // frame ran from +5 to +59 degrees of elevation and everything at or below the
      // horizon — the ground, the bases of the towers, any water at all — was off the
      // bottom of it. That is why the water primitive could not be seen at any level:
      // not a rendering bug, a framing one, and it took L3 reporting "no water is
      // visible" over a correct render three times to find it. Lower, the city gains
      // its own ground and its full depth, which it needed anyway.
      // Still off a thirds intersection, so the frame has somewhere for the eye to go.
      // Eased toward the subject rather than cut to it, and never all the way: at 1.0
      // the figure sits dead centre and the city stops being in the shot, which loses
      // the thing that makes the figure worth looking at.
      aim.set(Math.sin(ay + 0.42) * 70, 50 + framing * 60, Math.cos(ay + 0.42) * 70);
      if (focus) {
        // No extra lift here: `focusPoint()` already returns a point above the rig's
        // centroid. Adding a second one put the subject a third of the way down the
        // frame and pointed the camera at the skyline behind it.
        subject.set(focus[0], focus[1], focus[2]);
        // 0.88, not 0.72. At 0.72 the subject sits a third of the way in from the edge
        // and the frame is mostly the skyline behind it — L3 called it "jammed against
        // the left frame edge", which is what a weighted average of two points looks
        // like when the other point is a city. Never 1.0: at 1.0 the city stops being in
        // the shot, and the city is what makes the figure worth looking at.
        aim.lerp(subject, 0.88);
      }
      camera.lookAt(aim);
      winMat.opacity = (0.72 + Math.sin(elapsed * 1.7) * 0.06) * windowGlow;
      // A beacon is on or off, not dimmed: a sine here reads as a pulsing bulb, and
      // the thing being imitated is a shutter.
      beaconMat.opacity = (Math.sin(elapsed * 2.1) > 0.35 ? 0.95 : 0.06) * windowGlow;
      // Street light answers to the time of day for the same reason the windows do:
      // lamps burning at noon is one defect written in two places.
      lampMat.opacity = 0.55 * windowGlow;
      // The streets go out with the windows. Lit roads at noon is the same defect as
      // lamps at noon, written in a third place.
      streetMat.opacity = 0.9 * windowGlow;
    },
  };
}
