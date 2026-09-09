/**
 * Shareable worlds.
 *
 * A link carries **intent, not code**. The URL holds the utterances that built the
 * world; opening it replays them through the same pipeline — compiler, contracts,
 * L0/L1/L2, injection — that produced them the first time.
 *
 * That is a security property, and it falls out of the design rather than being bolted
 * on: there is no way to hand someone a Verbo link that injects arbitrary code into
 * their browser, because the link never contains code. It also means a shared world is
 * **re-verified on arrival** rather than trusted. If a primitive changed since the link
 * was made, the oracles judge the new result on its own merits and a verb that no
 * longer satisfies its contract simply does not appear.
 *
 * The cost is honest and worth stating: a replayed world is not guaranteed to be
 * pixel-identical to the original, only to satisfy the same contracts.
 */

const PREFIX = 'v1:';

/**
 * How many verbs a link carries. One number, enforced on both sides.
 *
 * The decoder has always bounded an incoming link — a link is a convenience, not a
 * way to make someone's browser run two hundred cycles on open. The encoder did not,
 * which made the bound a silent truncation of somebody else's world: past twelve
 * verbs the sharer copied a link the recipient would only partly receive, and neither
 * of them was told. The encoder now applies the same bound, so what is in the URL is
 * what arrives.
 */
export const MAX_LINK_VERBS = 12;

/**
 * Utterances only. Nothing else is small enough to belong in a URL, or safe there.
 *
 * The *last* twelve, not the first: the world is cumulative and later verbs supersede
 * earlier ones at the same state path, so the tail is the half that still describes
 * what is on screen. Repeats are dropped first, keeping the newest — twenty
 * injections of "make it rain" are one verb in the world (`runCycle` retires the
 * previous emitter), and a link that replayed them twenty times would spend twenty
 * cycles and nineteen injections of budget (D-6) to arrive at the same one emitter.
 */
export function encodeWorld(utterances: readonly string[]): string {
  const unique: string[] = [];
  for (const u of utterances) {
    const at = unique.indexOf(u);
    if (at !== -1) unique.splice(at, 1);
    unique.push(u);
  }
  const carried = unique.slice(-MAX_LINK_VERBS);
  if (carried.length === 0) return '';
  const json = JSON.stringify(carried);
  // btoa is Latin-1 only; encodeURIComponent first so non-ASCII utterances survive.
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return PREFIX + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeWorld(hash: string): string[] {
  const raw = hash.replace(/^#/, '');
  if (!raw.startsWith(PREFIX)) return [];
  const b64 = raw.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
  try {
    const json = decodeURIComponent(escape(atob(b64)));
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    // A shared link is untrusted input, and a hand-written one need not have gone
    // through `encodeWorld` — so the bound is enforced here too, not assumed.
    return value
      .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      .slice(0, MAX_LINK_VERBS)
      .map((u) => u.slice(0, 120));
  } catch {
    return [];
  }
}
