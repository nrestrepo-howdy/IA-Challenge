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

  constructor(host: HTMLElement) {
    this.#root = host;
  }

  begin(utterance: string): void {
    this.#lanes.clear();
    this.#root.textContent = '';
    this.#root.dataset['open'] = 'true';

    const head = document.createElement('div');
    head.className = 'vp-head';
    head.textContent = utterance;
    this.#root.append(head);
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
    }
  }

  end(): void {
    // Deliberately left open. The panel is the evidence; the moment after a decision
    // is when someone actually wants to read why the other two lost.
    this.#root.dataset['open'] = 'true';
  }

  #addLane(name: string): Lane {
    const row = document.createElement('div');
    row.className = 'vp-lane';

    const label = document.createElement('span');
    label.className = 'vp-name';
    label.textContent = name;
    row.append(label);

    const cells = new Map<Layer, HTMLElement>();
    for (const l of LAYERS) {
      const cell = document.createElement('span');
      cell.className = 'vp-cell';
      cell.dataset['state'] = 'pending';
      cell.textContent = l;
      cell.title = l === 'L3' ? 'perceptual — advisory only' : `${l} — must pass`;
      cells.set(l, cell);
      row.append(cell);
    }

    const note = document.createElement('span');
    note.className = 'vp-note';
    row.append(note);

    this.#root.append(row);
    const lane: Lane = { row, cells, note, settled: false };
    this.#lanes.set(name, lane);
    return lane;
  }
}
