/**
 * What is in the world right now.
 *
 * After five verbs the log has scrolled and the only record of what was built is the
 * world itself, which is exactly the thing that is hard to read. This lists the verbs
 * currently applied — from `world.snapshot().verbs`, the same list the shareable link
 * is made of, so it can never disagree with what a reload would rebuild.
 *
 * Rows are removable because removal is cheap here: the snapshot carries each verb's
 * source, so dropping one is a rebuild from the survivors rather than an unwind
 * (see `history.ts`). It renders nothing at all while the world is empty.
 */
import type { WorldSnapshot } from '../contracts.js';

type Verb = WorldSnapshot['verbs'][number];

export interface InventoryActions {
  readonly undo: () => void;
  readonly remove: (index: number) => void;
}

export class Inventory {
  readonly #root: HTMLElement;
  readonly #actions: InventoryActions;
  /**
   * What was on screen last time, so only genuinely new rows animate in.
   *
   * `render()` rebuilds the whole list on every change, so animating every row would
   * make dropping one verb look like the world had been rebuilt from nothing — which
   * is what happens underneath, and precisely what the chrome should not restate.
   */
  #shown: readonly string[] = [];

  constructor(host: HTMLElement, actions: InventoryActions) {
    this.#root = host;
    this.#actions = actions;
  }

  /** `canUndo` is passed in rather than inferred: history is not the verb list. */
  render(verbs: readonly Verb[], canUndo: boolean): void {
    this.#root.textContent = '';
    this.#root.dataset['open'] = verbs.length > 0 ? 'true' : 'false';
    if (verbs.length === 0) {
      this.#shown = [];
      return;
    }

    const head = document.createElement('div');
    head.className = 'inv-head';
    const label = document.createElement('span');
    label.textContent = `in the world · ${verbs.length} verb${verbs.length === 1 ? '' : 's'}`;
    head.append(label);
    if (canUndo) {
      const undo = document.createElement('button');
      undo.className = 'inv-undo';
      undo.type = 'button';
      undo.textContent = 'undo ⌘Z';
      undo.title = 'undo the last verb';
      undo.addEventListener('click', () => this.#actions.undo());
      head.append(undo);
    }
    this.#root.append(head);

    const before = this.#shown;
    verbs.forEach((verb, i) => {
      const row = document.createElement('div');
      row.className = 'inv-row';
      if (before[i] !== verb.utterance) row.dataset['new'] = 'true';

      const text = document.createElement('span');
      text.className = 'inv-verb';
      text.textContent = verb.utterance;
      text.title = verb.utterance;

      const drop = document.createElement('button');
      drop.className = 'inv-drop';
      drop.type = 'button';
      drop.textContent = '×';
      drop.title = `remove “${verb.utterance}”`;
      drop.setAttribute('aria-label', `remove ${verb.utterance}`);
      drop.addEventListener('click', () => this.#actions.remove(i));

      row.append(text, drop);
      this.#root.append(row);
    });
    this.#shown = verbs.map((v) => v.utterance);
  }
}
