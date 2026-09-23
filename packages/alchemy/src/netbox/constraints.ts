/**
 * NetBox's own rules, checked here, before the request is built.
 *
 * 🔴 THE INCIDENT THIS PATTERN EXISTS FOR, 2026-09-22 (Proxmox, not NetBox). `homeflare-proxmox`'s
 *   first `deploy:pbs` adopted ten objects and then failed its one create:
 *   `comment: value may only be 128 characters long`. Half a deploy in, on the server, from a
 *   limit the vendor publishes in its own schema and the generated type did not carry. Plan was
 *   green, `bun run check` was green, the adopt verifier was green. ★ NetBox gets the same
 *   treatment BEFORE its first write rather than after it.
 *
 * ★ SO THE TABLE IS GENERATED AND THIS FILE IS THE READER. `generated/constraints/*` is emitted
 *   from NetBox's own OpenAPI document by `bun codegen/netbox.ts`; nothing here is hand-typed,
 *   because a hand-typed limit is tribal knowledge that does not run.
 *
 * ⛔ A SEPARATE READER FROM `../proxmox/constraints.ts`, AND IT IS NOT DUPLICATION. That one
 *   checks a `PveForm` — every value already a string, because PVE takes form encoding. A NetBox
 *   body is JSON: a number stays a number, a boolean stays a boolean, a foreign key is an
 *   integer, and `String(value)` on any of them would make `minimum: 0` pass for `false` and
 *   `maxLength` meaningless. Sharing one reader would mean stringifying at the door, which is
 *   exactly the mangling the Proxmox version's own ⛔ warns about.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT ENFORCE, so nobody reads a green plan as more than it is:
 *   - a `format` NAME (`uri`, `email`, `date-time`): a validator DRF implements server-side.
 *     Recorded, never checked.
 *   - a pattern the generator could not carry faithfully (codegen/py-pattern.ts). Recorded
 *     verbatim as `patternSource`, never checked.
 *   - UNIQUENESS, VRF containment, custom-field validators, and every other rule that lives in
 *     Django rather than in the schema. Those still arrive as a server-side 400.
 *   Each is a fact in the table rather than a guess, which is the rule this follows: if the
 *   vendor did not state it, it is not enforced and the table says so.
 */

export interface ParamConstraint {
  readonly type?: string;
  /** From the schema's `required` array. ⚠️ Checked on CREATE only — see `violations`. */
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly string[];
  /** A JavaScript-safe translation. Absent when Python's dialect could not be carried over. */
  readonly pattern?: string;
  /** The vendor's own spelling, always — what a violation message quotes, and the audit trail. */
  readonly patternSource?: string;
  /** DRF's server-side validator name. Recorded so a reader knows what is NOT checked here. */
  readonly format?: string;
  readonly default?: string;
}

export type EndpointConstraints = Readonly<Record<string, ParamConstraint>>;

/** `netbox:POST /api/ipam/prefixes/` — exactly how the generated tables key an endpoint. */
export type EndpointKey = string;

/** A NetBox request body: JSON, with the types the schema declares. */
export type NetboxBody = Record<string, unknown>;

export interface ViolationOptions {
  /**
   * Check that every schema-required property is present.
   *
   * ⛔ CREATE ONLY. A NetBox update is a PATCH and is deliberately PARTIAL — it carries the fields
   *   that changed and nothing else — so requiring presence there would refuse every ordinary
   *   edit.
   */
  readonly presence?: boolean;
}

/**
 * ⚠️ `[...value].length`, NOT `value.length`. Django counts characters (Python `len` on a `str`
 *   counts code points); JavaScript counts UTF-16 code units, so an emoji in a description counts
 *   twice and a 200-character limit would refuse a description NetBox accepts. Rejecting a legal
 *   value at plan time is the one failure mode worse than the server 400 this replaces.
 */
const lengthOf = (value: string): number => [...value].length;

const checkString = (name: string, value: string, rule: ParamConstraint): string[] => {
  const out: string[] = [];
  if (rule.maxLength !== undefined && lengthOf(value) > rule.maxLength) {
    out.push(`${name}: at most ${String(rule.maxLength)} characters`);
  }
  if (rule.minLength !== undefined && lengthOf(value) < rule.minLength) {
    out.push(`${name}: at least ${String(rule.minLength)} characters`);
  }
  if (rule.enum !== undefined && !rule.enum.includes(value)) {
    out.push(`${name}: must be one of ${rule.enum.join(', ')}`);
  }
  if (rule.pattern !== undefined && !new RegExp(rule.pattern).test(value)) {
    out.push(`${name}: must match ${rule.patternSource ?? rule.pattern}`);
  }
  return out;
};

/**
 * ⛔ BOUNDS ARE CHECKED ONLY ON A REAL NUMBER, NEVER ON A COERCED ONE. `Number(false)` is 0 and
 *   `Number('')` is 0, so coercing would silently pass a boolean and an empty string through a
 *   `minimum: 0`. A NetBox body carries real numbers; anything else is a type error upstream.
 */
const checkNumber = (name: string, value: number, rule: ParamConstraint): string[] => {
  const out: string[] = [];
  if (!Number.isFinite(value)) return out;
  if (rule.minimum !== undefined && value < rule.minimum) {
    out.push(`${name}: at least ${String(rule.minimum)}`);
  }
  if (rule.maximum !== undefined && value > rule.maximum) {
    out.push(`${name}: at most ${String(rule.maximum)}`);
  }
  return out;
};

const checkValue = (name: string, value: unknown, rule: ParamConstraint): readonly string[] => {
  if (typeof value === 'string') return checkString(name, value, rule);
  if (typeof value === 'number') return checkNumber(name, value, rule);
  return [];
};

/**
 * Every vendor rule this body breaks, in the order the properties are declared. Pure: no network,
 * no clock, no environment — so `diff` can call it and a test can call it with a literal.
 *
 * ⚠️ A KEY THE TABLE DOES NOT MENTION IS NOT AN ERROR. The table carries the constrained
 *   properties, not every property, and a body may legitimately send an unconstrained one.
 * ⚠️ `null` IS A VALUE, NOT AN ABSENCE. NetBox uses explicit `null` to CLEAR a nullable foreign
 *   key, so it must not trip the presence check — and no string or number rule applies to it.
 */
export const violations = (
  table: EndpointConstraints,
  body: NetboxBody,
  options: ViolationOptions = {},
): readonly string[] => {
  const out: string[] = [];
  for (const [name, rule] of Object.entries(table)) {
    if (!Object.hasOwn(body, name)) {
      if (options.presence === true && rule.required === true) out.push(`${name}: required`);
      continue;
    }
    const value = body[name];
    // ⚠️ AN ARRAY IS A REPEATED VALUE (tags, and every many-to-many), so every element faces the
    //   same rule rather than the array being skipped as "not a scalar".
    for (const item of Array.isArray(value) ? value : [value]) {
      out.push(...checkValue(name, item, rule));
    }
  }
  return out;
};

/** The message a plan dies with. ⛔ Names the endpoint, because the rule belongs to the vendor. */
export const refusal = (endpoint: EndpointKey, found: readonly string[]): string =>
  `${endpoint} would be rejected by the vendor:\n  - ${found.join('\n  - ')}\n` +
  "These are NetBox's own limits, read from its published OpenAPI document " +
  '(packages/alchemy/src/netbox/generated/constraints). Fix the declaration.';
