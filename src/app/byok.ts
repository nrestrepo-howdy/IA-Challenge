/**
 * Bring your own key — so the hosted demo can show the system it describes.
 *
 * The local `npm run dev` proxy keeps the key server-side, which is the right shape
 * and the one that cannot be deployed: GitHub Pages is static, so a visitor to the
 * published URL gets the deterministic resolver and no model. The whole argument of
 * this project is about what agents do under verification, and the public link would
 * have demonstrated a phrasebook.
 *
 * So a visitor may supply **their own** key. It lives in `sessionStorage` and nowhere
 * else: not in the repository, not on a server of ours, not in a cookie that survives
 * the tab. Requests go from their browser straight to Anthropic with
 * `dangerouslyAllowBrowser`, which is exactly what that flag is for — the credential
 * belongs to the person typing it and never passes through us.
 *
 * That is a real trade and it is stated plainly in the UI rather than buried: a key in
 * a browser is readable by anything else running in that browser. The local path
 * exists for anyone who would rather not.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeResolver } from '../intent/model-resolver.js';
import type { LanguageModel } from '../intent/model.js';

const STORAGE_KEY = 'verbo.byok';

/** Session-scoped on purpose: closing the tab should end the arrangement. */
export function storedKey(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing, or storage disabled. Not an error worth surfacing — it just
    // means there is no key, which is the ordinary case.
    return null;
  }
}

export function storeKey(key: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, key);
  } catch { /* see above */ }
}

export function forgetKey(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* see above */ }
}

/** Shape check only. Whether it *works* is answered by the first call, not by a regex. */
export function looksLikeKey(value: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

export function browserModel(key: string): LanguageModel {
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  // Reuses the same resolver the server path uses, so the prompt, the schema, the
  // enum built from the catalogue and the required `unaddressed` field are identical.
  // A hosted visitor and a local developer are running the same resolution, which is
  // the only way the demo is evidence of anything.
  return new ClaudeResolver({ client });
}
