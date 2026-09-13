/**
 * Machine-written source, rendered so a person can read it while it is being judged.
 *
 * The panel next door shows *that* three programs were verified. Without this it never
 * showed *what* they were, and "three genuinely different programs" (D-5) stayed a
 * claim in a document rather than something on screen. `Candidate.source` is the exact
 * string handed to the prober and to the blob loader, so what is drawn here is the
 * artefact that was judged — not a paraphrase of it.
 *
 * Two jobs, both deliberately small:
 *
 *   - **Diff.** Candidates are read against the first one generated. A line-level LCS
 *     is enough at this size (the templates emit ten to fifteen lines) and it is the
 *     only honest way to answer "how are these three different?" — including when the
 *     answer is *they are not*, which is what happens to `reversed` whenever the brief
 *     has a single directive. Reversing a one-element list produces the same bytes, and
 *     a summary that said otherwise would be flattering the demo.
 *   - **Tint.** A five-class tokenizer, not a parser. It exists so the eye can find the
 *     import line and the parameter object at a glance; anything it mis-lexes still
 *     renders with the right text, because the text is sliced from the source and never
 *     rebuilt from tokens.
 */

export type LineKind = 'same' | 'add' | 'del';

export interface DiffLine {
  readonly text: string;
  readonly kind: LineKind;
}

/** Trailing blank lines are an artefact of the template, not a difference. */
export function splitLines(source: string): readonly string[] {
  return source.replace(/\s+$/, '').split('\n');
}

/**
 * A unified line diff of `source` against `base`.
 *
 * Every line of `source` survives into the result, which is the property that matters:
 * the block is still the module, with what the base had and this one lost shown
 * alongside rather than in place of it. `base` of `null` means "this is the base" and
 * yields the source unmarked.
 */
export function diffAgainst(base: string | null, source: string): readonly DiffLine[] {
  const next = splitLines(source);
  if (base === null) return next.map((text) => ({ text, kind: 'same' as const }));

  const prev = splitLines(base);
  const n = prev.length;
  const m = next.length;
  // Suffix LCS lengths: lcs[i][j] is the longest common subsequence of prev[i..] and
  // next[j..]. Flat rather than nested so the indexing stays readable under
  // noUncheckedIndexedAccess.
  const lcs = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number): number => lcs[i * (m + 1) + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = prev[i] === next[j]
        ? at(i + 1, j + 1) + 1
        : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (prev[i] === next[j]) {
      out.push({ text: next[j] ?? '', kind: 'same' });
      i++; j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push({ text: prev[i] ?? '', kind: 'del' });
      i++;
    } else {
      out.push({ text: next[j] ?? '', kind: 'add' });
      j++;
    }
  }
  while (i < n) out.push({ text: prev[i++] ?? '', kind: 'del' });
  while (j < m) out.push({ text: next[j++] ?? '', kind: 'add' });
  return out;
}

/**
 * The one-glance verdict on a candidate's shape: `base`, `identical`, or `+a −b`.
 *
 * `identical` is a real outcome and is said plainly. It is what a judge sees on any
 * single-directive utterance, and it explains the panel rather than embarrassing it:
 * the strategies differ in how they compose *several* directives, so with one there is
 * nothing for two of them to disagree about.
 */
export function summarise(lines: readonly DiffLine[], isBase: boolean): string {
  if (isBase) return 'base';
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === 'add') added++;
    else if (l.kind === 'del') removed++;
  }
  if (added === 0 && removed === 0) return 'identical';
  return `+${added} −${removed}`;
}

/**
 * Comment, string, keyword, number — in that precedence, in one pass.
 *
 * Alternation order is the whole of the correctness argument here: a `//` inside a
 * string literal must not start a comment, and `import` inside a comment must not
 * become a keyword, so whichever construct opens first wins the rest of its span.
 */
const TOKEN =
  /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(import|from|export|default|function|return|const|let|new|try|catch|throw|if|else|of|in|typeof)\b|(\d+(?:\.\d+)?)/g;

const CLASS: Readonly<Record<number, string>> = { 1: 't-c', 2: 't-s', 3: 't-k', 4: 't-n' };

/** Appends `text` to `host` as tinted spans. Text content is always sliced, never rebuilt. */
export function tint(host: HTMLElement, text: string): void {
  TOKEN.lastIndex = 0;
  let cursor = 0;
  for (;;) {
    const m = TOKEN.exec(text);
    if (m === null) break;
    if (m.index > cursor) host.append(text.slice(cursor, m.index));
    const group = [1, 2, 3, 4].find((g) => m[g] !== undefined) ?? 0;
    const span = document.createElement('span');
    span.className = CLASS[group] ?? '';
    span.textContent = m[0];
    host.append(span);
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) host.append(text.slice(cursor));
}

/** The source as a block of gutter-marked, tinted lines. */
export function renderSource(lines: readonly DiffLine[]): HTMLElement {
  const block = document.createElement('div');
  block.className = 'vp-src';
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'vp-ln';
    row.dataset['d'] = line.kind;

    const gutter = document.createElement('span');
    gutter.className = 'vp-g';
    gutter.textContent = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ';
    row.append(gutter);

    const code = document.createElement('span');
    code.className = 'vp-t';
    // A blank line still needs a box, or the block collapses where the module breathes.
    if (line.text.length === 0) code.append(' ');
    else tint(code, line.text);
    row.append(code);

    block.append(row);
  }
  return block;
}
