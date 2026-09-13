/**
 * The browser's route to the visual critic.
 *
 * L3 has existed since day nine and has never judged a single frame. `ClaudeVisualCritic`
 * was written, tested against a stub, and never reachable from the running app — the
 * layer whose whole job is to look at the result had never looked at anything, and the
 * log said so on every verb: *"no visual critic configured, so appearance was not
 * judged"*. Honest, and an admission that a quarter of the harness was decorative.
 *
 * This is the wire. The frame is encoded with the project's own dependency-free PNG
 * encoder and posted to the same proxy the resolver uses, so the key stays server-side.
 *
 * It remains advisory. `isInjectable()` decides, this does not, and a critic that fails
 * or is absent still produces a diagnosis naming what went unjudged rather than a pass
 * that pretends otherwise (D-1, AC-11).
 */
import type { Frame, VisualCritic } from '../harness/l3-perceptual.js';
import { encodePng, toBase64 } from '../harness/png.js';

export class ProxiedVisualCritic implements VisualCritic {
  async judge(frame: Frame, request: string): Promise<{ satisfied: boolean; note: string }> {
    const png = encodePng(frame);
    const res = await fetch('/api/critique', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        width: frame.width, height: frame.height, request,
        pixels: toBase64(png),
      }),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      // Thrown, not swallowed into a pass. The cycle catches this and says appearance
      // went unjudged, which is a different statement from "it looked fine".
      throw new Error(detail.error ?? `critic unavailable (${res.status})`);
    }
    return (await res.json()) as { satisfied: boolean; note: string };
  }
}
