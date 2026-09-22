/**
 * A vendor `parameters` schema that is NOT one flat `properties` map.
 *
 * 🔴 `Proxmox.HaRule`'s TABLE WAS EMPTY AND NOTHING SAID SO. MEASURED 2026-09-22: PVE spells
 *   `POST /cluster/ha/rules` as `parameters: {allOf: [{properties: {rule}}, {oneOf: […]}]}` — a
 *   discriminated union on `instance-type`, node-affinity or resource-affinity. The reader asked
 *   for `parameters.properties`, got `undefined`, and emitted `{}`. A wired family's plan-time
 *   guard therefore checked NOTHING, and an empty table is indistinguishable from an endpoint
 *   whose parameters happen to carry no rules. `comment` there has a `maxLength` of 4096 and
 *   `affinity` an enum of two — exactly the kind of limit this whole feature exists to catch.
 *
 * ★ SO THE TWO COMBINATORS ARE READ, AND THEIR LOGIC IS THEIR MEANING.
 *   - `allOf` branches ALL apply, so their properties MERGE. A key in two branches would have to
 *     satisfy both; that does not occur in either product today, and it THROWS rather than
 *     silently picking one.
 *   - `oneOf` branches are ALTERNATIVES, so they INTERSECT. A rule that holds in only one branch
 *     must not be enforced: a declaration of the other kind would be refused for breaking a rule
 *     the vendor never applied to it. Only what every branch states IDENTICALLY survives.
 *
 * ⛔ AND ANYTHING ELSE IS RECORDED AS UNRESOLVED, NEVER GUESSED. The caller stops if such an
 *   endpoint is one we actually write to — which is the difference between this and the empty
 *   table it replaces.
 */
import type { VendorParam } from './apidoc.ts';

export interface ResolvedParameters {
  readonly params: Readonly<Record<string, VendorParam>>;
  /** Set when the schema used a construct this file does not read. ⛔ Never a partial answer. */
  readonly unresolved?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const EMPTY: ResolvedParameters = { params: {} };

/**
 * ⚠️ `optional` IS NOT INTERSECTED FIELD-BY-FIELD, BECAUSE ITS ABSENCE MEANS REQUIRED. Dropping a
 *   disagreeing `optional` would turn "required in one branch" into "required in all of them" and
 *   refuse a legal declaration of the other kind. Disagreement therefore becomes `optional: 1`.
 */
const intersectParam = (a: VendorParam, b: VendorParam): VendorParam => {
  const out: Record<string, unknown> = {};
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key of Object.keys(left)) {
    if (key === 'optional') continue;
    if (JSON.stringify(left[key]) === JSON.stringify(right[key])) out[key] = left[key];
  }
  const required = (p: Record<string, unknown>) => p['optional'] !== 1 && p['optional'] !== true;
  out['optional'] = required(left) && required(right) ? 0 : 1;
  return out as VendorParam;
};

const intersect = (
  branches: readonly Readonly<Record<string, VendorParam>>[],
): Readonly<Record<string, VendorParam>> => {
  const [first, ...rest] = branches;
  if (first === undefined) return {};
  let out: Record<string, VendorParam> = { ...first };
  for (const branch of rest) {
    const next: Record<string, VendorParam> = {};
    for (const [name, param] of Object.entries(out)) {
      const other = branch[name];
      if (other !== undefined) next[name] = intersectParam(param, other);
    }
    out = next;
  }
  return out;
};

/** Every parameter an endpoint accepts, whatever shape the vendor wrapped them in. */
export const resolveParameters = (parameters: unknown): ResolvedParameters => {
  if (!isRecord(parameters)) return EMPTY;
  if (isRecord(parameters['properties'])) {
    return { params: parameters['properties'] as Readonly<Record<string, VendorParam>> };
  }
  if (Array.isArray(parameters['allOf'])) {
    const merged: Record<string, VendorParam> = {};
    for (const branch of parameters['allOf']) {
      const inner = resolveParameters(branch);
      if (inner.unresolved !== undefined) return inner;
      for (const [name, param] of Object.entries(inner.params)) {
        // ⛔ TWO allOf BRANCHES CLAIMING ONE KEY would have to satisfy both, which this file does
        //   not compute. Neither product does it today; say so rather than pick one.
        if (merged[name] !== undefined)
          return { params: {}, unresolved: `allOf repeats '${name}'` };
        merged[name] = param;
      }
    }
    return { params: merged };
  }
  if (Array.isArray(parameters['oneOf'])) {
    const branches: Readonly<Record<string, VendorParam>>[] = [];
    for (const branch of parameters['oneOf']) {
      const inner = resolveParameters(branch);
      if (inner.unresolved !== undefined) return inner;
      branches.push(inner.params);
    }
    return { params: intersect(branches) };
  }
  // A branch with neither — PVE writes `{additionalProperties: 0}` for "no parameters" — is empty,
  // not unreadable. An unknown KEY is the unreadable case.
  const known = ['properties', 'allOf', 'oneOf', 'additionalProperties', 'instance-type', 'type'];
  const strange = Object.keys(parameters).filter((key) => !known.includes(key));
  return strange.length === 0 ? EMPTY : { params: {}, unresolved: `unread keys ${strange.join()}` };
};
