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
import { MOODS } from '../intent/moods.js';
import { FIGURES } from '../intent/figures.js';

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

/**
 * One opener per tier, rather than three from the same shelf.
 *
 * The first version took the first three catalogue entries, which produced "add rain",
 * "add snow", "add wind" — three ways of saying the same thing, and the only impression
 * a first arrival could form from it is that this is a weather toy. It is the product's
 * own description of itself and it was underselling by a wide margin.
 *
 * So the three are drawn from the three surfaces the system actually has: a single
 * catalogue primitive, a mood the resolver composes from several, and a rig it writes
 * the motion for. They are still *derived* — from `CATALOGUE`, `MOODS` and `FIGURES`,
 * all of which are data — because the original argument holds and is the reason this
 * file exists: a written-down suggestion goes stale the moment something is renamed,
 * and a suggestion that produces a rejection teaches the user that the prompt lies.
 *
 * `tests/app/suggestions.test.ts` resolves every one of them offline, so a chip that
 * stopped working would fail the suite rather than the demo.
 */
export function deriveSuggestions(
  catalogue: readonly PrimitiveSpec[] = CATALOGUE,
  count = 3,
): readonly Suggestion[] {
  const out: Suggestion[] = [];
  const first = catalogue[0];
  if (first) out.push({ utterance: utteranceFor(first), summary: first.summary });

  // The longest trigger, because it is the one that reads as something a person would
  // type rather than as the key it is indexed under.
  const longest = (triggers: readonly string[]): string =>
    [...triggers].sort((a, b) => b.length - a.length)[0] ?? '';

  const mood = MOODS[0];
  if (mood && catalogue === CATALOGUE) {
    out.push({ utterance: longest(mood.triggers), summary: mood.rationale });
  }
  const figure = FIGURES[0];
  if (figure && catalogue === CATALOGUE) {
    out.push({ utterance: longest(figure.triggers), summary: figure.rationale });
  }

  // Any shortfall is filled from the catalogue, so a caller asking for more than the
  // other two surfaces can offer still gets what it asked for.
  for (const spec of catalogue.slice(1)) {
    if (out.length >= count) break;
    out.push({ utterance: utteranceFor(spec), summary: spec.summary });
  }
  return out.slice(0, count);
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
