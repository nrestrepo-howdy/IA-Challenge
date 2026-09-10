/**
 * The verification panel — the wait, made into the interesting part.
 *
 * While the agent works, the alternative is a spinner: dead time that says nothing and
 * asks the viewer to trust that something is happening. This shows the actual race —
 * three candidates, four layers, and which layer killed which candidate — driven by
 * real cycle events, not a scripted animation.
 *
 * It is also the only place the harness is *visible*. Everything the project argues
 * about verification is otherwise a claim in a document; here a rejection is a thing
 * that happens on screen, with the reason attached.
 *
 * Two rules it holds to:
 *
 *   - **It renders events, it never infers them.** No timers faking progress, no
 *     optimistic states. A lane advances because a layer reported, or it does not move.
 *   - **Rejections persist.** The failures are the evidence; clearing them the instant
 *     a winner appears would hide the part worth seeing.
 *
 * What the layout is doing: L0–L2 sit under one rule labelled *decide*, L3 sits apart
 * under a dashed one labelled *advises*. Four equal cells in a row would say the four
 * layers are equals, and the one thing this project insists on is that they are not.
 * The rule itself lives in `isInjectable()`; this only has to stop contradicting it.
 */
import type { CycleStep } from './cycle.js';

const LAYERS = ['L0', 'L1', 'L2', 'L3'] as const;
type Layer = (typeof LAYERS)[number];

interface Lane {
  readonly row: HTMLElement;
  readonly cells: Map<Layer, HTMLElement>;
  readonly note: HTMLElement;
  settled: boolean;
}

export class VerificationPanel {
  readonly #root: HTMLElement;
  readonly #lanes = new Map<string, Lane>();
  #body: HTMLElement | null = null;
  #state: HTMLElement | null = null;
  #accepted = false;

  constructor(host: HTMLElement) {
    this.#root = host;
  }

  begin(utterance: string): void {
    this.#lanes.clear();
    this.#accepted = false;
    this.#root.textContent = '';
    this.#root.dataset['open'] = 'true';

    const top = document.createElement('div');
    top.className = 'vp-top';

    const title = document.createElement('div');
    title.className = 'vp-title';
    title.textContent = utterance;
    title.title = utterance;

    const state = document.createElement('div');
    state.className = 'vp-state';
    state.dataset['state'] = 'running';
    state.textContent = 'verifying';
    this.#state = state;

    top.append(title, state);

    const body = document.createElement('div');
    body.className = 'vp-body';
    this.#body = body;

    this.#root.append(top, body);
  }

  /**
   * The column legend, added with the first lane rather than with the header.
   *
   * An utterance the catalogue cannot express never produces a candidate, and a
   * legend standing over no lanes labels nothing.
   */
  #columns(): void {
    const cols = document.createElement('div');
    cols.className = 'vp-cols';
    const decide = document.createElement('div');
    decide.className = 'vp-cols-decide';
    decide.textContent = 'decide';
    const advise = document.createElement('div');
    advise.className = 'vp-cols-advise';
    advise.textContent = 'advise';
    cols.append(decide, advise);
    this.#root.insertBefore(cols, this.#body);
  }

  step(s: CycleStep): void {
    if (!s.candidate) return;
    const lane = this.#lanes.get(s.candidate) ?? this.#addLane(s.candidate);
    if (lane.settled) return;

    if (s.kind === 'reject' && s.layer) {
      // Mark the layer that rejected, and grey what it never reached: a lane that
      // died at L0 was never judged by L2, and showing those as 'not run' rather
      // than 'failed' is the difference between a report and an accusation.
      for (const l of LAYERS) {
        const cell = lane.cells.get(l)!;
        if (l === s.layer) cell.dataset['state'] = 'failed';
        else if (LAYERS.indexOf(l) < LAYERS.indexOf(s.layer)) cell.dataset['state'] = 'passed';
        else cell.dataset['state'] = 'skipped';
      }
      lane.note.textContent = s.text.replace(/^[^:]+:\s*/, '');
      lane.note.title = s.text;
      lane.row.dataset['outcome'] = 'rejected';
      lane.settled = true;
      return;
    }

    if (s.kind === 'accept') {
      for (const l of LAYERS) {
        lane.cells.get(l)!.dataset['state'] = l === 'L3' ? 'advisory' : 'passed';
      }
      lane.note.textContent = 'injected';
      lane.row.dataset['outcome'] = 'accepted';
      lane.settled = true;
      this.#accepted = true;
      this.#setState('accepted', 'accepted');
    }
  }

  end(): void {
    // Deliberately left open. The panel is the evidence; the moment after a decision
    // is when someone actually wants to read why the other two lost.
    this.#root.dataset['open'] = 'true';
    if (!this.#accepted) this.#setState('rejected', 'rejected');
    // A lane still showing four blank cells after the decision looks like a layer
    // that has not answered yet. Nothing is pending once the cycle is over: the
    // cascade stops at the first candidate that clears, so the rest were never run,
    // and saying so is the difference between a stalled panel and a finished one.
    for (const lane of this.#lanes.values()) {
      if (lane.settled) continue;
      for (const cell of lane.cells.values()) cell.dataset['state'] = 'skipped';
      lane.note.textContent = 'not reached';
      lane.row.dataset['outcome'] = 'unreached';
      lane.settled = true;
    }
    this.#foot();
  }

  /**
   * An utterance that never reached a candidate.
   *
   * `main.ts` calls `begin()` before compiling, so a request the catalogue cannot
   * express used to leave a headed panel with no lanes under it — a box that had
   * started something and never said what happened. The reason goes where the lanes
   * would have been.
   */
  dismiss(reason: string): void {
    this.#setState('rejected', 'not attempted');
    if (!this.#body) return;
    const empty = document.createElement('div');
    empty.className = 'vp-empty';
    empty.textContent = reason;
    this.#body.append(empty);
  }

  #setState(kind: string, text: string): void {
    if (!this.#state) return;
    this.#state.dataset['state'] = kind;
    this.#state.textContent = text;
  }

  /** Said once, at the bottom, rather than implied by four cells that look alike. */
  #foot(): void {
    if (!this.#body || this.#root.querySelector('.vp-foot')) return;
    const foot = document.createElement('div');
    foot.className = 'vp-foot';
    const em = document.createElement('em');
    em.textContent = 'L3 judges appearance and never blocks';
    foot.append('L0–L2 decide whether a candidate may be injected. ', em, '.');
    this.#root.append(foot);
  }

  #addLane(name: string): Lane {
    if (this.#lanes.size === 0) this.#columns();
    const row = document.createElement('div');
    row.className = 'vp-lane';
    // The lanes arrive within a few milliseconds of each other; without the stagger
    // three rows appear as one block and the race is invisible.
    row.style.animationDelay = `${Math.min(this.#lanes.size, 3) * 55}ms`;

    const label = document.createElement('span');
    label.className = 'vp-name';
    label.textContent = name;
    label.title = name;
    row.append(label);

    const cells = new Map<Layer, HTMLElement>();
    for (const l of LAYERS) {
      const cell = document.createElement('span');
      cell.className = 'vp-cell';
      cell.dataset['state'] = 'pending';
      cell.dataset['layer'] = l;
      cell.textContent = l;
      cell.title = l === 'L3' ? 'perceptual — advisory only' : `${l} — must pass`;
      cells.set(l, cell);
      row.append(cell);
    }

    const note = document.createElement('span');
    note.className = 'vp-note';
    row.append(note);

    (this.#body ?? this.#root).append(row);
    const lane: Lane = { row, cells, note, settled: false };
    this.#lanes.set(name, lane);
    return lane;
  }
}
