/**
 * What to say first.
 *
 * An empty prompt in front of a world that only responds to a closed catalogue (D-2)
 * is a guessing game: the set of things that will work is knowable, so it is shown.
 *
 * Every suggestion is read out of `CATALOGUE` — never written down here. A written
 * list would go stale the moment a primitive is renamed or removed, and a suggestion
 * for a primitive that does not exist is worse than no suggestion at all: it teaches
 * the user that the prompt lies. The phrasing uses each entry's leading keyword,
 * which is the token the resolver actually matches on, so a click cannot produce a
 * rejection the catalogue could have avoided.
 */
import { CATALOGUE, type PrimitiveSpec } from '../intent/catalogue.js';

export interface Suggestion {
  /** Exactly what is said when it is clicked. Shown verbatim, so nothing is implied. */
  readonly utterance: string;
  readonly summary: string;
}

/**
 * `add` is filler to the resolver, so it steers nothing and the keyword decides —
 * which is the point: the suggestion is the catalogue's word, in a sentence.
 */
function utteranceFor(spec: PrimitiveSpec): string {
  return `add ${spec.keywords[0] ?? spec.name}`;
}

/** A few, not all: this is an opening move, not a menu. */
export function deriveSuggestions(
  catalogue: readonly PrimitiveSpec[] = CATALOGUE,
  count = 3,
): readonly Suggestion[] {
  return catalogue
    .slice(0, count)
    .map((spec) => ({ utterance: utteranceFor(spec), summary: spec.summary }));
}

/**
 * The row of openers under the prompt.
 *
 * It exists only while the world is empty. Once a verb lands, the world itself is the
 * thing to look at and the suggestions have done their job — a permanent row of
 * prompts would be chrome competing with the product.
 */
export class SuggestionRow {
  readonly #root: HTMLElement;

  constructor(host: HTMLElement, onPick: (utterance: string) => void) {
    this.#root = host;

    // The invitation, not just the buttons. A first arrival sees a world it has no
    // reason to believe responds to anything; two lines say what this is and what
    // happens to what you type, and the chips say what it already knows how to do.
    const lead = document.createElement('p');
    lead.className = 'sg-lead';
    lead.append('Say something. The world becomes it.');
    const sub = document.createElement('b');
    sub.textContent = 'Every verb is written, verified and only then injected.';
    lead.append(sub);
    this.#root.append(lead);

    const row = document.createElement('div');
    row.className = 'sg-row';
    for (const s of deriveSuggestions()) {
      const chip = document.createElement('button');
      chip.className = 'sg';
      chip.type = 'button';
      // Exactly the utterance and nothing else: the chip is a thing you could have
      // typed, so anything appended to it would be a promise the prompt cannot keep.
      chip.textContent = s.utterance;
      chip.title = s.summary;
      chip.addEventListener('click', () => onPick(s.utterance));
      row.append(chip);
    }
    this.#root.append(row);
  }

  setVisible(visible: boolean): void {
    this.#root.dataset['open'] = visible ? 'true' : 'false';
  }
}
