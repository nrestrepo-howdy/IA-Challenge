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
  AdditiveBlending, AmbientLight, BackSide, BoxGeometry, BufferAttribute, BufferGeometry,
  Color, DirectionalLight, Fog, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Points, PointsMaterial,
  Quaternion, Scene, SphereGeometry, Vector3,
} from 'three/webgpu';

export interface BaseScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  resize(w: number, h: number): void;
  update(elapsed: number): void;
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
  for (let i = 0; i < skyPos.count; i++) {
    const y = skyPos.getY(i) / 2400;
    c.copy(HORIZON).lerp(ZENITH, Math.pow(Math.max(0, Math.min(1, y * 1.5 + 0.18)), 0.75));
    skyCol[i * 3] = c.r; skyCol[i * 3 + 1] = c.g; skyCol[i * 3 + 2] = c.b;
  }
  skyGeo.setAttribute('color', new BufferAttribute(skyCol, 3));
  const sky = new Mesh(skyGeo, new MeshBasicMaterial({
    side: BackSide, depthWrite: false, fog: false, vertexColors: true,
  }));
  sky.frustumCulled = false;
  scene.add(sky);
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
  const starField = new Points(stars, new PointsMaterial({
    size: 3.2, sizeAttenuation: false, color: new Color(0.75, 0.82, 1),
    transparent: true, opacity: 0.55, depthWrite: false, fog: false,
  }));
  starField.frustumCulled = false;
  scene.add(starField);

  // ── Moon ───────────────────────────────────────────────────────────────────
  // In frame, and genuinely bright. Without a visible source, directional light reads
  // as an arbitrary global tint rather than as light coming from somewhere.
  const moon = new Mesh(
    new SphereGeometry(46, 24, 16),
    new MeshBasicMaterial({ color: new Color(0.96, 0.97, 1), fog: false }),
  );
  moon.position.set(-620, 430, -1350);
  scene.add(moon);
  const halo = new Mesh(
    new SphereGeometry(150, 20, 14),
    new MeshBasicMaterial({
      color: new Color(0.45, 0.56, 0.85), transparent: true, opacity: 0.16,
      blending: AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  halo.position.copy(moon.position);
  scene.add(halo);

  // ── Ground ─────────────────────────────────────────────────────────────────
  const ground = new Mesh(
    new PlaneGeometry(4000, 4000),
    new MeshStandardMaterial({
      // Wet-looking, not mirrored. metalness 0.62 against a 2.1 key clipped a
      // specular lobe to pure white right in front of the camera — the brightest
      // thing in frame was an artifact.
      color: new Color(0.026, 0.033, 0.048), roughness: 0.72, metalness: 0.18,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // ── Skyline ────────────────────────────────────────────────────────────────
  // Near-black, so it reads as silhouette against the sky. The previous version made
  // buildings and sky the same value, which is why nothing had an edge.
  const COUNT = 260;
  const blocks = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color: new Color(0.017, 0.022, 0.033), roughness: 0.82, metalness: 0.25 }),
    COUNT,
  );
  const m = new Matrix4(), q = new Quaternion(), pos = new Vector3(), scl = new Vector3();
  const windows: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 170 + rand() * 1000;
    const height = 28 + rand() * rand() * 300;
    const width = 16 + rand() * 30;
    const depth = width * (0.7 + rand() * 0.6);
    pos.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
    scl.set(width, height, depth);
    q.setFromAxisAngle(new Vector3(0, 1, 0), rand() * Math.PI);
    blocks.setMatrixAt(i, m.compose(pos, q, scl));

    // Lit windows, placed on the two faces that face the origin so the camera sees
    // them. The first attempt scattered them with sign flips that cancelled out and
    // put most of them inside the geometry, where they are invisible.
    const rows = Math.max(1, Math.floor(height / 22));
    const nx = Math.cos(angle), nz = Math.sin(angle);
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < 3; k++) {
        if (rand() > 0.3) continue;
        const lateral = (k - 1) * width * 0.3;
        windows.push(
          pos.x - nx * (depth / 2 + 1.2) - nz * lateral,
          14 + r * 22 + rand() * 6,
          pos.z - nz * (depth / 2 + 1.2) + nx * lateral,
        );
      }
    }
  }
  blocks.instanceMatrix.needsUpdate = true;
  scene.add(blocks);

  const winGeo = new BufferGeometry();
  winGeo.setAttribute('position', new BufferAttribute(new Float32Array(windows), 3));
  const winMat = new PointsMaterial({
    size: 3.4, color: new Color(1, 0.83, 0.55),
    transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false,
  });
  scene.add(new Points(winGeo, winMat));

  // ── Light ──────────────────────────────────────────────────────────────────
  const key = new DirectionalLight(new Color(0.68, 0.78, 1), 1.15);
  key.position.copy(moon.position);
  scene.add(key);
  scene.add(new AmbientLight(new Color(0.16, 0.22, 0.38), 0.5));

  const camera = new PerspectiveCamera(48, 1, 0.5, 4000);

  return {
    scene,
    camera,
    resize(w, h) {
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
    update(elapsed) {
      // A slow orbit, low to the ground so the skyline crosses the moon. Motion in the
      // base scene is what makes an injected change read as an addition to a living
      // world rather than a page that swapped itself out.
      const a = elapsed * 0.028;
      camera.position.set(Math.sin(a) * 165, 26 + Math.sin(elapsed * 0.09) * 4, Math.cos(a) * 165);
      camera.lookAt(0, 62, 0);
      winMat.opacity = 0.72 + Math.sin(elapsed * 1.7) * 0.06;
    },
  };
}
