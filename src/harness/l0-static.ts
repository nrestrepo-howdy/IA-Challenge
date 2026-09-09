/**
 * L0 · Static oracle.
 *
 * The cheapest layer, and the one that kills most candidates. It never executes the
 * module: it parses it. Runs in ~5 ms in plain Node with no browser and no GPU, which
 * is what makes the whole harness testable in CI (see docs/contracts/00-registry.md).
 *
 * Satisfies AC-04 (rejects non-compiling modules) and AC-05 (rejects out-of-scope writes).
 */
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import type { Candidate, Intent, Layer, Verdict } from '../contracts.js';

/**
 * Capabilities a generated module must never reach for.
 *
 * **What this layer is, precisely.** L0 is a lint against a model that wandered, not a
 * sandbox. An adversarial author defeats every check below in one line —
 * `globalThis['fe'+'tch']` is a computed member expression, and no AST walk that keys
 * on identifier names will ever see it. Twelve hand-written escapes were run through
 * this function and twelve passed, which is what prompted this comment.
 *
 * The real boundary is enforced at runtime, in the probe worker, by removing the
 * capabilities from the global object before the candidate is imported (see
 * `src/runtime/probe-worker.ts`). A capability that is not present cannot be reached
 * by any spelling of its name.
 *
 * L0 keeps its checks because catching drift in five milliseconds with an actionable
 * diagnosis is worth having — a model that reaches for `fetch` should be told so
 * immediately rather than after a worker teardown. But it is the cheap first filter,
 * and calling it a security boundary would be the kind of claim this project exists
 * to refuse.
 */
const FORBIDDEN_GLOBALS = new Set([
  'eval', 'Function', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'document', 'localStorage', 'sessionStorage', 'indexedDB', 'Worker',
  // Reaching the global object at all is the move that makes every other check
  // pointless, so asking for it is itself the finding.
  'globalThis', 'self', 'window', 'postMessage', 'Notification', 'navigator',
]);

const STATE_ROOT = '__VERBO_STATE__';

export interface StaticFinding {
  readonly rule: 'parse' | 'forbidden-global' | 'import-not-allowed' | 'out-of-scope-write';
  readonly detail: string;
  readonly line: number | null;
}

export function analyze(source: string, intent: Intent): StaticFinding[] {
  const findings: StaticFinding[] = [];

  let ast;
  try {
    ast = parse(source, { ecmaVersion: 2022, sourceType: 'module', locations: true });
  } catch (err) {
    // A parse failure is terminal: nothing else can be said about the module.
    const e = err as { message?: string; loc?: { line: number } };
    return [{ rule: 'parse', detail: e.message ?? 'unparseable', line: e.loc?.line ?? null }];
  }

  const allowed = new Set(intent.allowedPrimitives);
  const inScope = (path: string): boolean =>
    intent.scope.some((s) => path === s || path.startsWith(s + '.'));

  simple(ast, {
    Identifier(node: any) {
      if (FORBIDDEN_GLOBALS.has(node.name)) {
        findings.push({
          rule: 'forbidden-global',
          detail: `'${node.name}' is not available to generated modules`,
          line: node.loc?.start.line ?? null,
        });
      }
    },

    ImportDeclaration(node: any) {
      const spec = String(node.source.value);
      // Only the primitive library is importable. D-2: the agent composes, it does
      // not reach outside the surface it was given.
      if (!spec.startsWith('verbo:')) {
        findings.push({
          rule: 'import-not-allowed',
          detail: `import '${spec}' — only 'verbo:*' primitives may be imported`,
          line: node.loc?.start.line ?? null,
        });
        return;
      }
      const name = spec.slice('verbo:'.length);
      if (!allowed.has(name)) {
        findings.push({
          rule: 'import-not-allowed',
          detail: `primitive '${name}' is not in this intent's allowed set`,
          line: node.loc?.start.line ?? null,
        });
      }
    },

    AssignmentExpression(node: any) {
      const path = memberPath(node.left);
      if (path?.startsWith(STATE_ROOT + '.')) {
        const slice = path.slice(STATE_ROOT.length + 1);
        if (!inScope(slice)) {
          findings.push({
            rule: 'out-of-scope-write',
            detail: `writes '${slice}', outside declared scope [${intent.scope.join(', ')}]`,
            line: node.loc?.start.line ?? null,
          });
        }
      }
    },

    ImportExpression(node: any) {
      // `import(...)` is a CallExpression, not an ImportDeclaration, so the static
      // import check above never saw it. A dynamic import is an arbitrary URL.
      findings.push({
        rule: 'import-not-allowed',
        detail: 'dynamic import() is not available to generated modules',
        line: node.loc?.start.line ?? null,
      });
    },

    MemberExpression(node: any) {
      // A computed read off the state root defeats the assignment check below by
      // spelling the path at runtime: `__VERBO_STATE__[k].camera = ...`.
      if (node.computed && node.object?.type === 'Identifier' && node.object.name === STATE_ROOT) {
        findings.push({
          rule: 'out-of-scope-write',
          detail: `computed access into '${STATE_ROOT}' — paths must be written literally so they can be checked`,
          line: node.loc?.start.line ?? null,
        });
      }
    },

    VariableDeclarator(node: any) {
      // Aliasing the state root moves every later write out of this analysis's sight.
      if (node.init?.type === 'Identifier' && node.init.name === STATE_ROOT) {
        findings.push({
          rule: 'out-of-scope-write',
          detail: `'${STATE_ROOT}' may not be aliased; writes must name their path`,
          line: node.loc?.start.line ?? null,
        });
      }
    },

    CallExpression(node: any) {
      // world.register(instance, statePath) — the statePath must be declared.
      const callee = memberPath(node.callee);
      if (callee?.endsWith('.register')) {
        const arg = node.arguments[1];
        if (arg && arg.type !== 'Literal') {
          // A computed path cannot be checked, so it is refused rather than trusted.
          findings.push({
            rule: 'out-of-scope-write',
            detail: 'register() needs a literal state path; a computed one cannot be checked',
            line: node.loc?.start.line ?? null,
          });
        } else if (arg?.type === 'Literal' && typeof arg.value === 'string') {
          if (!inScope(arg.value)) {
            findings.push({
              rule: 'out-of-scope-write',
              detail: `registers at '${arg.value}', outside declared scope [${intent.scope.join(', ')}]`,
              line: node.loc?.start.line ?? null,
            });
          }
        }
      }
    },
  });

  return findings;
}

/** Flattens a static member expression to a dotted path, or null if it is dynamic. */
function memberPath(node: any): string | null {
  const parts: string[] = [];
  let cur = node;
  while (cur?.type === 'MemberExpression') {
    if (cur.computed || cur.property?.type !== 'Identifier') return null;
    parts.unshift(cur.property.name);
    cur = cur.object;
  }
  if (cur?.type !== 'Identifier') return null;
  parts.unshift(cur.name);
  return parts.join('.');
}

export const L0_LAYER: Layer = 'L0';

export function evaluateL0(c: Candidate, i: Intent): Omit<Verdict, 'candidateId'> {
  const started = performance.now();
  const findings = analyze(c.source, i);
  const compileMs = performance.now() - started;

  return {
    passed: findings.length === 0,
    failedAt: findings.length === 0 ? null : L0_LAYER,
    // Actionable text, not a score: the repair agent has to be able to act on it.
    diagnosis: findings.length === 0 ? null
      : findings.map((f) => `[${f.rule}]${f.line ? ` line ${f.line}:` : ''} ${f.detail}`).join('\n'),
    metrics: {
      compileMs, medianFrameMs: null, drawCalls: null, pixelDelta: null,
      assertionsPassed: 0, assertionsTotal: 0,
    },
    frame: null,
  };
}
