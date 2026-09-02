/**
 * Parameter validation against the catalogue's JSON Schema subset.
 *
 * A model that names a real primitive can still hand it nonsense ("count": 5e9), and a
 * parameter that is out of range produces code that fails L1 twenty seconds later.
 * Catching it here turns a wasted verification cycle into an explained rejection
 * (AC-17) — the same reason the whole compiler is deterministic downstream of the one
 * model call.
 *
 * Only the subset the catalogue actually uses is implemented. A general JSON Schema
 * engine would be more code and strictly less checkable.
 */
import type { ParamSchema, PropertySchema } from './catalogue.js';

export interface ParamViolation {
  readonly param: string;
  readonly detail: string;
  /** A value that would have been accepted, when one is obvious. Feeds the suggestion. */
  readonly repair: unknown | null;
}

/** Fills defaults, then validates. Unknown keys are violations: the surface is closed (D-2). */
export function validateParams(
  schema: ParamSchema,
  defaults: Readonly<Record<string, unknown>>,
  proposed: Readonly<Record<string, unknown>>,
): { readonly params: Record<string, unknown>; readonly violations: readonly ParamViolation[] } {
  const violations: ParamViolation[] = [];
  const params: Record<string, unknown> = { ...defaults };

  for (const [key, value] of Object.entries(proposed)) {
    const prop = schema.properties[key];
    if (!prop) {
      violations.push({
        param: key,
        detail: `'${key}' is not a parameter of this primitive; expected one of [${Object.keys(schema.properties).join(', ')}]`,
        repair: null,
      });
      continue;
    }
    const v = checkProperty(key, prop, value);
    if (v) violations.push(v);
    else params[key] = value;
  }

  for (const key of schema.required) {
    if (params[key] === undefined) {
      violations.push({ param: key, detail: `'${key}' is required and has no default`, repair: null });
    }
  }

  return { params, violations };
}

function checkProperty(key: string, prop: PropertySchema, value: unknown): ParamViolation | null {
  switch (prop.type) {
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { param: key, detail: `'${key}' must be a finite number, got ${fmt(value)}`, repair: null };
      }
      if (prop.type === 'integer' && !Number.isInteger(value)) {
        return { param: key, detail: `'${key}' must be an integer, got ${value}`, repair: Math.round(value) };
      }
      if (value < prop.minimum || value > prop.maximum) {
        return {
          param: key,
          detail: `'${key}' is ${value}, outside [${prop.minimum}, ${prop.maximum}]`,
          repair: Math.min(prop.maximum, Math.max(prop.minimum, value)),
        };
      }
      return null;
    }

    case 'string':
      return prop.enum.includes(value as string)
        ? null
        : {
            param: key,
            detail: `'${key}' is ${fmt(value)}, expected one of [${prop.enum.join(', ')}]`,
            repair: prop.enum[0] ?? null,
          };

    case 'array': {
      if (!Array.isArray(value)) {
        return { param: key, detail: `'${key}' must be an array of ${prop.minItems} numbers`, repair: null };
      }
      if (value.length < prop.minItems || value.length > prop.maxItems) {
        return {
          param: key,
          detail: `'${key}' has ${value.length} components, expected ${prop.minItems}`,
          repair: null,
        };
      }
      for (let i = 0; i < value.length; i++) {
        const c: unknown = value[i];
        if (typeof c !== 'number' || !Number.isFinite(c) || c < prop.items.minimum || c > prop.items.maximum) {
          return {
            param: key,
            detail: `'${key}'[${i}] is ${fmt(c)}, outside [${prop.items.minimum}, ${prop.items.maximum}]`,
            repair: null,
          };
        }
      }
      return null;
    }
  }
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return `'${v}'`;
  if (v === undefined) return 'undefined';
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}
