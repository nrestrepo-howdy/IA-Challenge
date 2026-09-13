/**
 * Moods — the offline resolver's answer to language that names a feeling, not a thing.
 *
 * The keyword resolver matched a word to a primitive. "make it rain" worked and "make
 * it cozy" was rejected, because no primitive is called cozy. Three of twelve ordinary
 * sentences resolved; the other nine were refused by a product that could in fact have
 * built something reasonable for every one of them.
 *
 * A mood is a **composition** the catalogue can express, named by a word people
 * actually use. It is not a guess: each one names primitives that exist with parameters
 * inside their declared ranges, and it goes through the same compiler, the same
 * contracts and the same oracles as anything else. Nothing about the verification path
 * changes because a mood was what selected the primitives.
 *
 * This is deliberately a floor, not a ceiling. A hosted model reads intent; this reads
 * a phrasebook. But a phrasebook that covers what people say beats a matcher that only
 * covers what the catalogue is called, and the gap between them was the difference
 * between a product and a demo.
 */
export interface Mood {
  /** Phrases that select it. Matched as substrings, so multi-word entries work. */
  readonly triggers: readonly string[];
  readonly rationale: string;
  readonly primitives: readonly { name: string; params: Readonly<Record<string, unknown>> }[];
}

export const MOODS: readonly Mood[] = [
  {
    triggers: ['blade runner', 'cyberpunk', 'neo noir', 'noir', 'dystopian', 'neon city'],
    rationale: 'rain, haze and searchlights over a night city',
    primitives: [
      { name: 'daylight', params: { phase: 0 } },
      { name: 'rain-emitter', params: { count: 9000 } },
      { name: 'fog-volume', params: { density: 0.06 } },
      { name: 'searchlights', params: {} },
    ],
  },
  {
    triggers: ['cozy', 'cosy', 'warm', 'comfortable', 'homely', 'snug'],
    rationale: 'low warm light, soft haze and quiet snow',
    primitives: [
      { name: 'daylight', params: { phase: 0.78 } },
      { name: 'fog-volume', params: { density: 0.045, color: [0.16, 0.13, 0.12] } },
      { name: 'snow-emitter', params: {} },
    ],
  },
  {
    triggers: ['apocalyptic', 'apocalypse', 'end of the world', 'doomed', 'hellish', 'ominous', 'dangerous', 'menacing'],
    rationale: 'a heavy storm over a dark, drowned city',
    primitives: [
      { name: 'daylight', params: { phase: 0.04 } },
      { name: 'rain-emitter', params: { count: 12000, speed: 42 } },
      { name: 'lightning', params: {} },
      { name: 'wind-field', params: {} },
      { name: 'fog-volume', params: { density: 0.09 } },
    ],
  },
  {
    triggers: ['beautiful', 'gorgeous', 'stunning', 'surprise me', 'something nice', 'wow',
               'amazing', 'spectacular', 'hola', 'hello', 'hi', 'anything', 'whatever'],
    rationale: 'aurora and water under a clear night',
    primitives: [
      { name: 'daylight', params: { phase: 0 } },
      { name: 'aurora', params: {} },
      { name: 'water', params: {} },
      { name: 'flock', params: {} },
    ],
  },
  {
    triggers: ['dramatic', 'epic', 'cinematic', 'moody', 'atmosphere', 'atmospheric', 'more drama'],
    rationale: 'searchlights and haze against a low sun',
    primitives: [
      { name: 'daylight', params: { phase: 0.82 } },
      { name: 'fog-volume', params: { density: 0.07 } },
      { name: 'searchlights', params: {} },
      { name: 'skyline-shift', params: { heightScale: 1.8 } },
    ],
  },
  {
    triggers: ['peaceful', 'calm', 'quiet', 'serene', 'still', 'gentle'],
    rationale: 'a clear dawn over calm water',
    primitives: [
      { name: 'daylight', params: { phase: 0.27 } },
      { name: 'water', params: {} },
      { name: 'flock', params: {} },
    ],
  },
  {
    triggers: ['desert', 'dunes', 'arid', 'sahara', 'wasteland', 'ground-tint'],
    rationale: 'pale sand under a high sun',
    primitives: [
      { name: 'daylight', params: { phase: 0.5 } },
      { name: 'ground-tint', params: { color: [0.52, 0.42, 0.28], roughness: 0.95 } },
      { name: 'fog-volume', params: { density: 0.03, color: [0.62, 0.54, 0.42] } },
    ],
  },
  {
    triggers: ['underwater', 'drowned', 'flooded', 'submerged', 'atlantis'],
    rationale: 'deep water over a dimmed city',
    primitives: [
      { name: 'water', params: {} },
      { name: 'daylight', params: { phase: 0.42 } },
      { name: 'fog-volume', params: { density: 0.11, color: [0.08, 0.18, 0.22] } },
    ],
  },
];

/**
 * The mood an utterance names, if any.
 *
 * Longest trigger first, so "end of the world" is not beaten by "world" appearing
 * inside it, and so a two-word phrase outranks a one-word one that happens to be a
 * substring of it.
 */
export function matchMood(utterance: string): Mood | null {
  const text = ` ${utterance.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
  let best: { mood: Mood; length: number } | null = null;
  for (const mood of MOODS) {
    for (const trigger of mood.triggers) {
      if (!text.includes(` ${trigger} `) && !text.includes(`${trigger} `) && !text.includes(` ${trigger}`)) continue;
      if (!best || trigger.length > best.length) best = { mood, length: trigger.length };
    }
  }
  return best?.mood ?? null;
}
