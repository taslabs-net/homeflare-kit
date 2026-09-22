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
 * ⚠️ WHAT IT DELIBERATELY DOES NOT ENFORCE, so nobody reads a green plan as more than it is:
 *   - a `format` NAME (PVE's `pve-calendar-event`, `pve-node`, 216 of them): the name is a
 *     validator PVE implements server-side and publishes nothing about. Recorded, never checked.
 *   - a pattern the generator could not translate faithfully (codegen/pattern.ts). Recorded
 *     verbatim as `patternSource`, never checked.
 *   - PBS `schedule`, which carries `typetext: <calendar-event>` and NO pattern and NO maxLength.
 *     The schema cannot help there; a malformed schedule still reaches PBS.
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
  /** A JavaScript-safe translation. Absent when the vendor's dialect could not be carried over. */
  readonly pattern?: string;
  /** The vendor's own spelling, always — what a violation message quotes, and the audit trail. */
  readonly patternSource?: string;
  /** PVE's server-side validator name. Recorded so a reader knows what is NOT checked here. */
  readonly format?: string;
  readonly default?: string;
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
  if (rule.pattern !== undefined && !new RegExp(rule.pattern).test(value)) {
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
