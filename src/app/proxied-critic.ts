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
import { toBase64 } from '../harness/png.js';

export class ProxiedVisualCritic implements VisualCritic {
  async judge(frame: Frame, request: string): Promise<{ satisfied: boolean; note: string }> {
    // The frame crosses as pixels, not as a PNG of pixels.
    //
    // It used to cross encoded, and the receiving end read those bytes back into
    // `frame.data` as though they were RGBA and encoded them again. The model was
    // shown a picture of a compressed byte stream and reported, accurately, "nothing
    // but horizontal noise bands on a white background" — of a night city that had
    // rendered correctly. Nothing threw, because a 160x90 frame is 57,600 bytes and
    // its PNG was 57,758: close enough to fill the array and never look wrong.
    //
    // `Frame` is already the shape both sides agree on, so sending it is both simpler
    // and the reason it cannot happen again — there is now exactly one encoder, on
    // the side that talks to the model.
    const res = await fetch('/api/critique', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        width: frame.width,
        height: frame.height,
        request,
        // A view, not a copy: `Frame.data` is clamped and `toBase64` takes plain bytes.
        pixels: toBase64(new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)),
      }),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(detail.error ?? `critic unavailable (${res.status})`);
    }
    return (await res.json()) as { satisfied: boolean; note: string };
  }
}
