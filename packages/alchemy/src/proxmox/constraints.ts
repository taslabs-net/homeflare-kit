/**
 * The vendor's own rules, checked here, before the request is built.
 *
 * 🔴 THE INCIDENT THIS EXISTS FOR, 2026-09-22. `homeflare-proxmox`'s first `deploy:pbs` adopted ten
 *   objects and then failed its one create: `PVE POST config/verify -> 400: parameter verification
 *   failed - comment: value may only be 128 characters long`. Half a deploy in, on the server, from
 *   a limit PBS publishes in its own schema and the generated `comment?: string` does not carry.
 *   Plan was green. `bun run check` was green. `hf-adopt-verify` was green — its offline fake serves
 *   a fixture and refuses anything but GET, so a newly declared object's VALUES are never exercised.
 *
 * ★ SO THE TABLE IS GENERATED AND THIS FILE IS THE READER. `generated/constraints/*` is emitted
 *   from the cluster's own `apidoc.js` by `bun codegen/constraints.ts`; nothing here is hand-typed,
 *   because a hand-typed limit is the tribal knowledge that was already in a doc comment and
 *   already did not run.
 *
 * ⛔ IT CHECKS THE FORM, NOT THE PROPS, AND THAT IS THE WHOLE POINT. The form is what goes on the
 *   wire: `String(props['max-depth'])`, `'0' | '1'` for a boolean, an omitted key for an undeclared
 *   field. A props-level check would pass values the form then mangles, and would have to be
 *   written once per family — which is how the copy that forgets a field gets written.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT ENFORCE, so nobody reads a green plan as more than it is. The
 *   full kind-by-kind table, with the counts measured over the 37 tabled endpoints, is in
 *   codegen/README.md. The short version:
 *   - a `format` NAME (PVE's `pve-calendar-event`, `pve-node`; 105 parameters here): the name is a
 *     validator PVE implements server-side and publishes nothing about. Recorded, never checked.
 *   - a `format` OBJECT — PBS's `notify`, `tuning`, `maintenance-mode`, PVE's `bwlimit`; 10
 *     parameters. It is a sub-schema for the inside of a PROPERTY STRING, and the packed keys
 *     carry their own limits. Not flattened, because a rule about `notify` is not a rule about
 *     `notify.gc`. ⛔ This is the largest remaining gap and it is a gap on purpose.
 *   - `requires` (8 parameters): "this one needs that one". A dependency, not a value rule.
 *   - `typetext` with nothing else, such as PBS `schedule`'s `<calendar-event>` (21 parameters).
 *     The schema states a syntax it does not describe; a malformed schedule still reaches PBS.
 *   - a pattern the generator could not translate faithfully (codegen/pattern.ts). Recorded
 *     verbatim as `patternSource`, never checked.
 *   Each of those is a fact in the table rather than a guess, which is the rule this follows:
 *   if the vendor did not state it, it is not enforced and the table says so.
 */
import type { PveForm } from './client.ts';

export interface ParamConstraint {
  readonly type?: string;
  /** From the vendor's `optional`. ⚠️ Checked on CREATE only — see `violations`. */
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly string[];
  /**
   * A JavaScript-safe EQUIVALENT. Absent when the vendor's dialect could not be carried over.
   *
   * ⛔ NOT THE VENDOR'S SPELLING, AND FOR PVE NOT EVEN THE SAME SHAPE. PVE publishes the inside of
   *   an anchored match and applies `m/^$pattern$/` itself (MEASURED in JSONSchema.pm), so the
   *   generator anchors it here. Quote `patternSource` at a human, never this.
   */
  readonly pattern?: string;
  /** `m` when the vendor asked for multi-line. ⚠️ Dropping it enforces the wrong semantics. */
  readonly patternFlags?: string;
  /** The vendor's own spelling, always — what a violation message quotes, and the audit trail. */
  readonly patternSource?: string;
  /** PVE's server-side validator name. Recorded so a reader knows what is NOT checked here. */
  readonly format?: string;
  readonly default?: string;
  /**
   * The value rules describe each ELEMENT of a repeated key, not one joined string.
   *
   * ⚠️ RECORDED, NOT BRANCHED ON. `violations` already checks every element of an array value, so
   *   this changes no behaviour — it tells a reader of the generated table why a `maxLength` of 32
   *   sits on a parameter that carries a list.
   */
  readonly each?: true;
}

export type EndpointConstraints = Readonly<Record<string, ParamConstraint>>;

/** `POST /config/verify` — exactly how the generated tables key an endpoint. */
export type EndpointKey = string;

export interface ViolationOptions {
  /**
   * Check that every vendor-required parameter is present.
   *
   * ⛔ CREATE ONLY. An update form is deliberately PARTIAL — `formToSend` sends the fields that
   *   changed and nothing else — so requiring presence there would refuse every ordinary edit.
   */
  readonly presence?: boolean;
}

const lengthOf = (value: string): number => [...value].length;

/**
 * ⚠️ `[...value].length`, NOT `value.length`. Proxmox counts characters; JavaScript counts UTF-16
 *   code units, so an emoji in a comment counts twice and a 128-character limit would refuse a
 *   comment PBS accepts. Rejecting a legal value at plan time is the one failure mode worse than
 *   the server 400 this replaces.
 */
const checkValue = (name: string, value: string, rule: ParamConstraint): string[] => {
  const out: string[] = [];
  if (rule.maxLength !== undefined && lengthOf(value) > rule.maxLength) {
    out.push(`${name}: at most ${rule.maxLength} characters`);
  }
  if (rule.minLength !== undefined && lengthOf(value) < rule.minLength) {
    out.push(`${name}: at least ${rule.minLength} characters`);
  }
  if (rule.enum !== undefined && !rule.enum.includes(value)) {
    out.push(`${name}: must be one of ${rule.enum.join(', ')}`);
  }
  // ⚠️ `patternFlags` IS PASSED, NOT IGNORED. It carries the vendor's own `(?m)`; enforcing a
  //   multi-line rule with single-line semantics refuses values the vendor accepts.
  if (rule.pattern !== undefined && !new RegExp(rule.pattern, rule.patternFlags).test(value)) {
    out.push(`${name}: must match ${rule.patternSource ?? rule.pattern}`);
  }
  // ⚠️ NUMBER-NESS IS NOT CHECKED, ONLY THE BOUND. The form is strings by construction and a
  //   non-numeric string is a type error upstream; `Number('')` is 0, so a blank would read as in
  //   range. Guarding on Number.isFinite keeps a blank from silently passing a minimum of 0.
  const numeric = Number(value);
  const bounded = rule.minimum !== undefined || rule.maximum !== undefined;
  if (bounded && value !== '' && Number.isFinite(numeric)) {
    if (rule.minimum !== undefined && numeric < rule.minimum) {
      out.push(`${name}: at least ${rule.minimum}`);
    }
    if (rule.maximum !== undefined && numeric > rule.maximum) {
      out.push(`${name}: at most ${rule.maximum}`);
    }
  }
  return out;
};

/**
 * Every vendor rule this form breaks, in the order the parameters are declared. Pure: no network,
 * no clock, no environment — so `diff` can call it and a test can call it with a literal.
 *
 * ⚠️ A KEY THE TABLE DOES NOT MENTION IS NOT AN ERROR. The table carries the constrained
 *   parameters, not every parameter, and a form may legitimately send an unconstrained one.
 */
export const violations = (
  table: EndpointConstraints,
  form: PveForm,
  options: ViolationOptions = {},
): readonly string[] => {
  const out: string[] = [];
  for (const [name, rule] of Object.entries(table)) {
    const value = form[name];
    if (value === undefined) {
      if (options.presence === true && rule.required === true) out.push(`${name}: required`);
      continue;
    }
    // ⚠️ AN ARRAY IS REPEATED KEYS ON THE WIRE (client.ts), so every element faces the same rule.
    for (const item of typeof value === 'string' ? [value] : value) {
      out.push(...checkValue(name, item, rule));
    }
  }
  return out;
};

/** The message a plan dies with. ⛔ Names the endpoint, because the rule belongs to the vendor. */
export const refusal = (endpoint: EndpointKey, found: readonly string[]): string =>
  `${endpoint} would be rejected by the vendor:\n  - ${found.join('\n  - ')}\n` +
  "These are the vendor's own limits, read from its published schema " +
  '(packages/alchemy/src/proxmox/generated/constraints). Fix the declaration.';
