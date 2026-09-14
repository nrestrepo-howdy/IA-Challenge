/**
 * The figure primitive — a rig of shapes, and a function of time that moves it.
 *
 * This is the one place the agent writes behaviour rather than choosing it, and it
 * exists because of a question the catalogue could not answer: *"un perro con una
 * persona paseando"*. Fifteen primitives of weather, light and city met that with
 * "cannot express", which is honest and is also the whole product admitting it is a
 * lighting desk rather than a world.
 *
 * It is deliberately **not** the free-form Three.js synthesis D-2 rejects, and the
 * distinction is the load-bearing part. A generated module here cannot import three,
 * cannot touch the scene graph, cannot create a material, and cannot name a geometry
 * that is not one of four. What it writes is `pose(t, parts)` — arithmetic returning
 * numbers. R-1 measures how often a model produces a behaviourally correct *Three.js
 * world*; writing `Math.sin(t * 4) * 0.6` for a leg swing is not that task.
 *
 * What makes it safe to run is not that it is small. It is that it is verified like
 * everything else: L0 lints the module, L1 runs it in a worker with its capabilities
 * revoked, L2 asserts the rig actually moves, and L3 says whether it looks like what
 * was asked for. A closed catalogue meant the harness had nothing dangerous to guard;
 * this is the first code in the project that genuinely needs it.
 */
import type { Primitive, PrimitiveInstance, WorldHandle } from '../contracts.js';

/**
 * The shapes a rig may be built from. Eight, and no way to ask for a ninth.
 *
 * It was four — box, sphere, capsule, cylinder — and every one of them is a *blob*.
 * None has a direction. Asked for an aeroplane, the model could only answer with boxes,
 * and a pile of boxes is a pile of boxes however carefully it is arranged: what makes a
 * low-poly object recognisable is its silhouette, and a silhouette needs shapes that
 * point somewhere.
 *
 * The four added are the directional ones. A `cone` is a nose, a spire, a tree; a
 * `wedge` is a wing, a roof, a ramp; a `pyramid` is a crown or a tent; a `torus` is a
 * wheel or a ring. Between them a fuselage with a nose and swept wings becomes
 * expressible, which it simply was not before.
 */
export const SHAPES = ['box', 'sphere', 'capsule', 'cylinder', 'cone', 'wedge', 'pyramid', 'torus'] as const;
export type Shape = (typeof SHAPES)[number];

export interface PartSpec {
  readonly id: string;
  readonly shape: Shape;
  /** Half-extents, in world units. A person is about 3.4 tall here. */
  readonly size: readonly [number, number, number];
  readonly color: readonly [number, number, number];
  /** 0..1. A lamp, an eye, a tail light — anything that should survive the night. */
  readonly emissive?: number;
}

/**
 * What `pose` is handed. One entry per part, in declaration order, and the only
 * writable surface a generated function gets.
 */
export interface PoseTarget {
  x: number; y: number; z: number;
  /** Radians, applied in YXZ order — yaw first, which is how a walk cycle reads. */
  yaw: number; pitch: number; roll: number;
  /** A multiplier on the declared size. Bounded, so a part cannot swallow the frame. */
  scale: number;
}

export interface FigureParams {
  readonly name: string;
  readonly parts: readonly PartSpec[];
  /** Where the whole rig stands. */
  readonly origin?: readonly [number, number, number];
  /**
   * The generated half. Called once per frame with the elapsed seconds and the array
   * of targets, already seeded with each part's rest pose.
   */
  readonly pose: (t: number, parts: PoseTarget[]) => void;
}

/** Bounds every rig is held to, whoever wrote it. */
const MAX_PARTS = 48;
const MAX_SIZE = 40;
const MAX_REACH = 400;
const MAX_SCALE = 8;

export class FigureValidationError extends Error {
  constructor(detail: string) {
    super(`figure: ${detail}`);
    this.name = 'FigureValidationError';
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validate(params: FigureParams): readonly PartSpec[] {
  if (typeof params.name !== 'string' || !/^[a-z0-9-]{1,40}$/.test(params.name)) {
    throw new FigureValidationError(`name '${String(params.name)}' must be lowercase, dashed, 1-40 chars`);
  }
  if (typeof params.pose !== 'function') throw new FigureValidationError('pose must be a function');
  const parts = params.parts;
  if (!Array.isArray(parts) || parts.length === 0) throw new FigureValidationError('needs at least one part');
  if (parts.length > MAX_PARTS) throw new FigureValidationError(`${parts.length} parts exceeds the ${MAX_PARTS} limit`);

  const ids = new Set<string>();
  for (const part of parts) {
    if (!SHAPES.includes(part.shape)) {
      throw new FigureValidationError(`'${String(part.shape)}' is not a shape; use ${SHAPES.join(', ')}`);
    }
    if (typeof part.id !== 'string' || part.id.length === 0) throw new FigureValidationError('every part needs an id');
    if (ids.has(part.id)) throw new FigureValidationError(`duplicate part id '${part.id}'`);
    ids.add(part.id);
    if (!Array.isArray(part.size) || part.size.length !== 3 || !part.size.every(isNum)) {
      throw new FigureValidationError(`part '${part.id}' size must be three finite numbers`);
    }
    if (part.size.some((v: number) => v <= 0 || v > MAX_SIZE)) {
      throw new FigureValidationError(`part '${part.id}' size must be within (0, ${MAX_SIZE}]`);
    }
    if (!Array.isArray(part.color) || part.color.length !== 3 || !part.color.every(isNum)) {
      throw new FigureValidationError(`part '${part.id}' color must be three finite numbers`);
    }
  }
  return parts;
}

/** Clamped rather than rejected: a pose that overshoots for one frame is not a defect. */
const clamp = (v: number, limit: number): number => (isNum(v) ? Math.max(-limit, Math.min(limit, v)) : 0);

class FigureInstance implements PrimitiveInstance {
  #elapsed = 0;
  #targets: PoseTarget[] = [];
  #slice: Record<string, unknown> | null = null;
  #disposed = false;

  constructor(readonly id: string, private readonly params: FigureParams, private readonly parts: readonly PartSpec[]) {}

  attach(slice: Record<string, unknown>): void {
    this.#slice = slice;
    this.#targets = this.parts.map(() => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, scale: 1 }));
    this.update(0);
  }

  update(dt: number): void {
    if (this.#disposed || !this.#slice) return;
    this.#elapsed += dt;
    // Reset to rest before every call, so a `pose` that sets only some parts on some
    // frames cannot accumulate drift from whatever the last frame happened to leave.
    for (const target of this.#targets) {
      target.x = 0; target.y = 0; target.z = 0;
      target.yaw = 0; target.pitch = 0; target.roll = 0; target.scale = 1;
    }
    this.params.pose(this.#elapsed, this.#targets);

    const origin = this.params.origin ?? [0, 0, 0];
    const flat = new Array<number>(this.#targets.length * 7);
    for (let i = 0; i < this.#targets.length; i++) {
      const t = this.#targets[i]!;
      const o = i * 7;
      // Clamped on the way out rather than trusted on the way in. A NaN here would
      // reach a Float32Array as zero and look deliberate; a part a thousand units away
      // would take the camera's whole frame with it.
      flat[o] = clamp((origin[0] ?? 0) + t.x, MAX_REACH);
      flat[o + 1] = clamp((origin[1] ?? 0) + t.y, MAX_REACH);
      flat[o + 2] = clamp((origin[2] ?? 0) + t.z, MAX_REACH);
      flat[o + 3] = clamp(t.yaw, Math.PI * 4);
      flat[o + 4] = clamp(t.pitch, Math.PI * 4);
      flat[o + 5] = clamp(t.roll, Math.PI * 4);
      flat[o + 6] = Math.max(0.01, Math.min(MAX_SCALE, isNum(t.scale) ? t.scale : 1));
    }
    this.#slice['pose'] = flat;
    this.#slice['elapsed'] = this.#elapsed;
  }

  dispose(): void {
    this.#disposed = true;
    this.#slice = null;
  }
}

/**
 * `verbo:figure`, as the generated module imports it.
 *
 * `statePath` is the parent rather than the instance, because one binding renders every
 * rig in the world: the renderer reconciles the whole `figures` subtree, and a binding
 * per figure would mean a binding registry that changes at runtime.
 */
export function createFigure(): Primitive<FigureParams> {
  let ordinal = 0;
  return {
    name: 'figure',
    schema: { type: 'object' },
    statePath: 'figures',
    mount(world: WorldHandle, params: FigureParams): PrimitiveInstance {
      const parts = validate(params);
      const id = `figure#${ordinal++}`;
      const instance = new FigureInstance(id, params, parts);
      world.register(instance, `figures.${params.name}`);
      const slice = world.slice(id);
      // The descriptor is the part of the state a binding builds meshes from, and it
      // never changes; `pose` is the part that must, and the contract says so.
      slice['parts'] = parts.map((p) => ({
        id: p.id, shape: p.shape,
        size: [p.size[0], p.size[1], p.size[2]],
        color: [p.color[0], p.color[1], p.color[2]],
        emissive: isNum(p.emissive) ? Math.max(0, Math.min(1, p.emissive)) : 0,
      }));
      slice['count'] = parts.length;
      slice['instance'] = id;
      instance.attach(slice);
      return instance;
    },
  };
}
