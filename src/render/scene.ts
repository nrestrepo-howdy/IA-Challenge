/**
 * The base scene.
 *
 * Deliberately authored rather than generated: SPEC §2 states Verbo starts from an
 * authored scene and the agent extends it. A world that begins as an empty grey plane
 * makes every later addition look like a demo of a demo.
 *
 * Night, because the verbs the catalogue supports -- rain, snow, fog, moving light --
 * all read more strongly against a dark ground, and because a scene that is already
 * saturated with daylight has nowhere to go when something is added to it.
 */
import {
  AmbientLight, BoxGeometry, Color, DirectionalLight, Fog, InstancedMesh,
  Matrix4, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Quaternion,
  Scene, Vector3,
} from 'three/webgpu';

export interface BaseScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  resize(w: number, h: number): void;
  update(elapsed: number): void;
}

/** Deterministic, so the scene is identical on every load and in every screenshot. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBaseScene(): BaseScene {
  const scene = new Scene();
  const horizon = new Color(0.043, 0.055, 0.078);
  scene.background = horizon;
  scene.fog = new Fog(horizon, 60, 1100);

  const camera = new PerspectiveCamera(52, 1, 0.5, 3000);
  camera.position.set(0, 34, 128);
  camera.lookAt(0, 22, 0);

  const ground = new PlaneGeometry(2600, 2600);
  const groundMat = new MeshStandardMaterial({
    color: new Color(0.055, 0.062, 0.075), roughness: 0.82, metalness: 0.12,
  });
  const plane = new (InstancedMesh as never as typeof InstancedMesh)(ground, groundMat, 1);
  plane.setMatrixAt(0, new Matrix4().compose(
    new Vector3(0, 0, 0),
    new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2),
    new Vector3(1, 1, 1),
  ));
  scene.add(plane);

  // A skyline of instanced blocks: one draw call, and it gives the fog and the rain
  // something to occlude. Depth is what makes weather read as weather.
  const rand = rng(0x5eed);
  const COUNT = 220;
  const blocks = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color: new Color(0.075, 0.082, 0.1), roughness: 0.7, metalness: 0.2 }),
    COUNT,
  );
  const m = new Matrix4(), q = new Quaternion(), pos = new Vector3(), scl = new Vector3();
  for (let i = 0; i < COUNT; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 150 + rand() * 900;
    const height = 18 + rand() * rand() * 190;
    const width = 14 + rand() * 26;
    pos.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
    scl.set(width, height, width * (0.7 + rand() * 0.6));
    q.setFromAxisAngle(new Vector3(0, 1, 0), rand() * Math.PI);
    blocks.setMatrixAt(i, m.compose(pos, q, scl));
  }
  blocks.instanceMatrix.needsUpdate = true;
  scene.add(blocks);

  const moon = new DirectionalLight(new Color(0.72, 0.79, 1), 1.15);
  moon.position.set(-220, 340, -160);
  scene.add(moon);
  scene.add(new AmbientLight(new Color(0.3, 0.36, 0.5), 0.28));

  return {
    scene,
    camera,
    resize(w, h) {
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
    update(elapsed) {
      // A slow orbit. Motion in the base scene is what makes an injected change read
      // as an addition to a living world rather than a page that swapped itself out.
      const a = elapsed * 0.035;
      camera.position.set(Math.sin(a) * 132, 34 + Math.sin(elapsed * 0.11) * 3, Math.cos(a) * 132);
      camera.lookAt(0, 24, 0);
    },
  };
}
