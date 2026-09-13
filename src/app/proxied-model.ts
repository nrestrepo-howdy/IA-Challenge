/**
 * The browser's route to a real model.
 *
 * `main.ts` built its compiler with no model at all, so the shipped product resolved
 * utterances with a keyword table: "make it rain" worked, "make it cozy" was rejected,
 * and nothing anywhere called an LLM. Three tested model components were unreachable
 * from the running app.
 *
 * This is the missing wire. It speaks the same `LanguageModel` interface the compiler
 * already takes, so nothing downstream changes — the contract, the oracles and the
 * injection path are identical whether the answer came from Claude or from keywords.
 *
 * **Falling back is not the same as failing.** If the server has no key, or the call
 * fails, this returns `null` and the caller uses the deterministic resolver. The
 * difference is reported, because a user who typed something the model would have
 * understood deserves to know why it was rejected instead of assuming the product
 * cannot do it.
 */
import type { LanguageModel, ModelRequest } from '../intent/model.js';

export interface ProxyStatus {
  readonly live: boolean;
  readonly reason: string | null;
}

export class ProxiedModel implements LanguageModel {
  #status: ProxyStatus = { live: false, reason: 'not yet contacted' };

  get status(): ProxyStatus {
    return this.#status;
  }

  async propose(request: ModelRequest): Promise<string> {
    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ error: res.statusText }));
      this.#status = { live: false, reason: String(detail.error ?? res.statusText) };
      throw new Error(`resolver unavailable: ${this.#status.reason}`);
    }
    this.#status = { live: true, reason: null };
    const { raw } = (await res.json()) as { raw: string };
    return raw;
  }
}

/**
 * Tries the model, falls back to keywords, and never lets a dead proxy stop the world.
 *
 * The order matters: the model is tried *first*, because the whole point is that a
 * person can say what they mean. Keywords are the floor, not the default.
 */
export function withFallback(model: LanguageModel, floor: LanguageModel,
                             onFallback: (reason: string) => void): LanguageModel {
  return {
    async propose(request: ModelRequest): Promise<string> {
      try {
        const proposal = await model.propose(request);
        answered = 'model';
        return proposal;
      } catch (err) {
        onFallback(String(err instanceof Error ? err.message : err));
        answered = 'phrasebook';
        return floor.propose(request);
      }
    },
  };
}

/**
 * Which resolver answered the last utterance.
 *
 * Reported because the numbers are not comparable without it. The nightly evaluation
 * ran for eleven nights against the static preview build, which has no proxy, so every
 * row it recorded was the phrasebook — 26 of 30 at 66 ms. That is a true measurement of
 * something, and it is not the product: the same 26 of 30 at fifteen seconds would be a
 * completely different claim. A run that does not say which resolver spoke cannot be
 * read later by anyone, including whoever wrote it.
 */
let answered: 'model' | 'phrasebook' = 'phrasebook';

export function lastResolver(): 'model' | 'phrasebook' {
  return answered;
}
