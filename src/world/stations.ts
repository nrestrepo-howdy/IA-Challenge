/**
 * Where a rig stands, so that two rigs never stand in the same place.
 *
 * Every figure in the catalogue was authored with the same origin — `[-65, 0, 2]` —
 * because each was written and looked at on its own. Ask for a person and then for a
 * car and they are mounted three metres from the world's centre, both of them, walking
 * the same short line through each other. Nothing in state is wrong; the rigs are
 * simply all standing on one spot, and the world looks like a collision rather than a
 * place.
 *
 * A station is claimed by name and kept. That matters more than it looks: a state path
 * is `figures.<name>`, so the same name is the *same rig* being replaced — re-running an
 * utterance must put it back where it was, not walk it across the plaza — while a
 * different name is a different thing that needs its own ground. Keying on the name
 * gets both for free, and gets it deterministically, which the three candidates of a
 * cycle and the mount/unmount of probing both depend on.
 *
 * The layout is a phyllotaxis spiral: turn by the golden angle each time and step out
 * by the square root of the count. It is the arrangement a sunflower uses, and it is
 * here for the same reason — no two stations line up, the spacing stays even however
 * many are claimed, and it fills outward instead of crowding a ring. Alternating
 * headings come out of it for free, so the figures do not all pace the same axis like a
 * parade.
 */
import { FIGURE_SCALE } from './figure.js';

/** 2.39996… radians. Consecutive stations are never collinear with the centre. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Metres. The first station sits clear of the centre — a rig standing exactly on the
 * origin is the one place the wide shot orbits around — and the spacing is wide enough
 * that two rigs pacing their own few metres cannot reach each other.
 */
const FIRST_RING_M = 16;
const SPACING_M = 15;

/**
 * Metres. The city leaves its core open out to 260, and buildings are inset from there;
 * staying well inside that is what keeps a figure off a rooftop. Past this the spiral
 * wraps rather than walking rigs into the building ring — by then there are seventy of
 * them and a repeat is the lesser fault.
 */
const MAX_RADIUS_M = 170;

export interface Station {
  /** Authored units, to be added to a pose. Y is left to the rig: some of them fly. */
  readonly origin: readonly [number, number, number];
  /** Radians of yaw applied to the whole rig, so figures do not all pace one axis. */
  readonly heading: number;
}

const claimed = new Map<string, number>();
let next = 0;

/** The k-th spot on the spiral, in world metres. */
function ringRadius(k: number): number {
  return Math.min(MAX_RADIUS_M, FIRST_RING_M + SPACING_M * Math.sqrt(k));
}

export function stationFor(name: string): Station {
  let index = claimed.get(name);
  if (index === undefined) {
    index = next++;
    claimed.set(name, index);
  }
  const angle = index * GOLDEN_ANGLE;
  const radius = ringRadius(index) / FIGURE_SCALE;
  return {
    origin: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
    // Tangential: a figure paces across its own arc rather than straight at or away
    // from the centre the camera sits over.
    heading: angle + Math.PI / 2,
  };
}

/**
 * Forgets every claim.
 *
 * Only the tests need this, and they need it because the allocator is deliberately
 * stateful: without it one test's claims would shift the next one's stations and the
 * failure would read as a placement bug rather than as shared state.
 */
export function resetStations(): void {
  claimed.clear();
  next = 0;
}
