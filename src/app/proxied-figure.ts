/**
 * The rig author, over the same proxy the resolver and the critic use.
 *
 * Same reason as both of those: the key stays in the Node process and the browser calls
 * a same-origin endpoint. What crosses is an utterance and a rig — no code from the
 * page, and no credential toward it.
 */
import type { FigureAuthor } from '../intent/figure-model.js';
import type { FigureSpec } from '../intent/figures.js';

export class ProxiedFigureAuthor implements FigureAuthor {
  async author(utterance: string): Promise<FigureSpec | null> {
    const res = await fetch('/api/figure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ utterance }),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(detail.error ?? `figure author unavailable (${res.status})`);
    }
    const body = (await res.json()) as { figure: FigureSpec | null };
    return body.figure;
  }
}
