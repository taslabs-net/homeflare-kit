/**
 * A pure payload gate for `client.systemOne({ state, questions })` calls: it checks a
 * caller-declared field allowlist (type, length and count caps) and scans for
 * secret-shaped content, and returns either a frozen `{ state, questions, json }` ready
 * to send, or a `no-judgment` refusal that names a field path, a rule id and a reason —
 * never the text that tripped it. Decision 22 (2026-09-23): PR bodies and private-repo
 * source excerpts may be sent to TypeSafe only through this gate; a secret-shape
 * refusal refuses the whole call and never redacts-and-sends.
 *
 * ⛔ PURE AND RUNTIME-NEUTRAL. No network, no filesystem, no `bun:*`/`node:*` — same
 *   rule as src/index.ts (AGENTS.md). This module never imports the SDK either: the
 *   caller passes the gated `state`/`questions` on to `systemOne()` itself.
 */
import { type ScanOptions, type ScanReason, scanPayload } from './scan.ts';

/** Structurally identical to `@typesafe-ai/sdk`'s own `JsonValue` (measured
 *  2026-09-23, node_modules/@typesafe-ai/sdk@0.6.0/dist/index.d.mts) — declared LOCALLY
 *  rather than imported, because this module stays SDK-free (file header above), and
 *  structural typing makes the two interchangeable at the call site regardless. A
 *  MUTABLE array type, deliberately: see {@link deepFreeze}'s comment for why. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JudgmentFieldType = 'string' | 'string[]' | 'number' | 'boolean' | 'object';

export interface JudgmentFieldSpec {
  readonly type: JudgmentFieldType;
  /** `string`: max characters. `string[]`: max characters PER ELEMENT. */
  readonly maxLength?: number;
  /** `string[]` only: max array length. */
  readonly maxItems?: number;
  /** `object` only: the nested field spec — required for `type: 'object'`; a field
   *  declared `object` with no `fields` refuses every value, fail closed. */
  readonly fields?: JudgmentSpec;
}

export type JudgmentSpec = Readonly<Record<string, JudgmentFieldSpec>>;

export type GateReason =
  | ScanReason
  | 'unknown-field'
  | 'over-length'
  | 'over-count'
  | 'wrong-type'
  | 'not-object'
  | 'internal-error';

export interface GateOptions extends ScanOptions {}

export type GateResult =
  | {
      readonly kind: 'send';
      readonly state: Record<string, JsonValue>;
      readonly questions: Record<string, JsonValue>;
      readonly json: string;
    }
  | {
      readonly kind: 'no-judgment';
      readonly reason: GateReason;
      readonly path: string;
      readonly rule?: string;
    };

export interface GatePayload {
  readonly state: unknown;
  readonly questions: unknown;
}

interface Refusal {
  readonly reason: GateReason;
  readonly path: string;
}

function validateField(spec: JudgmentFieldSpec, value: unknown, path: string): Refusal | undefined {
  switch (spec.type) {
    case 'string': {
      if (typeof value !== 'string') return { reason: 'wrong-type', path };
      if (spec.maxLength !== undefined && value.length > spec.maxLength)
        return { reason: 'over-length', path };
      return undefined;
    }
    case 'string[]': {
      if (!Array.isArray(value)) return { reason: 'wrong-type', path };
      if (spec.maxItems !== undefined && value.length > spec.maxItems)
        return { reason: 'over-count', path };
      for (let i = 0; i < value.length; i++) {
        const el: unknown = value[i];
        if (typeof el !== 'string') return { reason: 'wrong-type', path: `${path}[${i}]` };
        if (spec.maxLength !== undefined && el.length > spec.maxLength)
          return { reason: 'over-length', path: `${path}[${i}]` };
      }
      return undefined;
    }
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? undefined
        : { reason: 'wrong-type', path };
    case 'boolean':
      return typeof value === 'boolean' ? undefined : { reason: 'wrong-type', path };
    case 'object':
      if (spec.fields === undefined) return { reason: 'wrong-type', path };
      return validateObject(spec.fields, value, path);
  }
}

function validateObject(spec: JudgmentSpec, value: unknown, path: string): Refusal | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { reason: 'not-object', path };
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!Object.hasOwn(spec, key)) return { reason: 'unknown-field', path: `${path}.${key}` };
  }
  for (const [key, fieldSpec] of Object.entries(spec)) {
    if (!Object.hasOwn(obj, key)) continue;
    const hit = validateField(fieldSpec, obj[key], `${path}.${key}`);
    if (hit) return hit;
  }
  return undefined;
}

/** Freezes `value` in place and returns the SAME reference, typed as `T` rather than
 *  `Readonly<T>`. ⚠️ THE READONLY-ARRAY TRAP (measured against `@typesafe-ai/sdk`
 *  0.6.0's `JsonValue = string | number | boolean | null | JsonValue[] | {…}` —
 *  a MUTABLE array type). `Object.freeze`'s own TS signature returns `Readonly<T>`,
 *  which turns every array into `readonly X[]` and then fails to satisfy `JsonValue`.
 *  Freezing for real while keeping the static type mutable is the whole point of this
 *  wrapper — never call `Object.freeze` directly on a `send` payload. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

function gateInner(spec: JudgmentSpec, payload: GatePayload, options: GateOptions): GateResult {
  const stateErr = validateObject(spec, payload.state, '$.state');
  if (stateErr) return { kind: 'no-judgment', ...stateErr };

  if (
    typeof payload.questions !== 'object' ||
    payload.questions === null ||
    Array.isArray(payload.questions)
  ) {
    return { kind: 'no-judgment', reason: 'not-object', path: '$.questions' };
  }

  const scanHit = scanPayload(payload.state, payload.questions, options);
  if (scanHit) return { kind: 'no-judgment', ...scanHit };

  // Only now — validated, scanned, clean — copy and freeze. A fresh copy means a
  // caller mutating their original afterwards changes nothing about what was sent.
  const state = deepFreeze(structuredClone(payload.state)) as Record<string, JsonValue>;
  const questions = deepFreeze(structuredClone(payload.questions)) as Record<string, JsonValue>;
  const json = JSON.stringify({ state, questions });

  return { kind: 'send', state, questions, json };
}

/**
 * Gate a `{state, questions}` payload against a judgment field spec before it ever
 * reaches `client.systemOne()`. Never throws: any unexpected internal failure comes
 * back as `no-judgment` / `internal-error` rather than an exception a caller might not
 * fail closed on.
 */
export function gate(
  spec: JudgmentSpec,
  payload: GatePayload,
  options: GateOptions = {},
): GateResult {
  try {
    return gateInner(spec, payload, options);
  } catch {
    return { kind: 'no-judgment', reason: 'internal-error', path: '$' };
  }
}
