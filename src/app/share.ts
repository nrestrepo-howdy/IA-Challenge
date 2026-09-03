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

/** Utterances only. Nothing else is small enough to belong in a URL, or safe there. */
export function encodeWorld(utterances: readonly string[]): string {
  if (utterances.length === 0) return '';
  const json = JSON.stringify(utterances);
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
    // A shared link is untrusted input. Bound it: a link is a convenience, not a way
    // to make someone's browser run two hundred cycles on open.
    return value
      .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      .slice(0, 12)
      .map((u) => u.slice(0, 120));
  } catch {
    return [];
  }
}
