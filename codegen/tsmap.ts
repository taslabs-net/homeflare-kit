/**
 * The vendor's own parameter and return schemas, mapped to TypeScript.
 *
 * ⛔ THIS IS THE MAPPING NOBODY COULD READ BEFORE. `generated/{pve,pbs}.ts` have said
 *   `Run: bun codegen/generate.ts` since the day they were committed and
 *   `git log --oneline --all -- 'codegen/generate*'` is empty, so the only statement of what the
 *   types mean was the types themselves. Every rule below is written down here instead, with the
 *   measurement that justifies it.
 *
 * ⛔ A REQUEST PARAMETER IS TEXT ON THE WIRE, AND THAT IS MEASURED, NOT ASSUMED. `client.ts` sends
 *   `application/x-www-form-urlencoded` and types the body `PveForm =
 *   Record<string, readonly string[] | string>`; `constraints.ts` says in as many words that "the
 *   form is strings by construction". So the honest fix for the old generator's widening is NOT
 *   `number` — a `number` cannot be handed to `pve()` at all — it is a NARROWER STRING.
 *
 * ★ SO AN INTEGER PARAMETER IS `` `${number}` ``, NOT `string`. It still satisfies `PveForm`, it
 *   still reaches `violations`' `Number(value)` bound check unchanged, and it refuses `'banana'`
 *   where the old `string` accepted it. A caller with a number writes `` `${n}` ``.
 *   ⚠️ `String(n)` IS NOT ASSIGNABLE TO IT — `String` returns plain `string`. That is the one
 *     ergonomic cost, and it is deliberate: the template literal is the spelling that carries the
 *     numeric-ness across, and the compiler saying so is the point.
 *   ⚠️ `` `${number}` `` ADMITS `'1.5'` WHERE THE SCHEMA SAYS INTEGER. TypeScript has no
 *     integer-valued string type that a `` `${n}` `` template still satisfies (`` `${bigint}` ``
 *     refuses one), so integrality and the numeric bounds stay where they are already ENFORCED —
 *     the generated constraint tables, checked at plan time by constraint-guard.ts.
 *
 * ★ A BOOLEAN PARAMETER STAYS `'0' | '1'`, AND THAT IS NOT WIDENING — IT IS THE ENCODING. It is
 *   exactly what `values.ts`'s `flag()` produces and exactly what goes on the wire. `boolean` here
 *   would be a type no form builder in this package could return.
 */
import type { TsExpr, TsField } from './tsexpr.ts';
import { atom, inline, quote, union } from './tsexpr.ts';

/**
 * One property of a vendor parameter or return schema. Only the keys this mapping reads.
 *
 * ⛔ `oneOf` HERE IS A PROPERTY'S OWN ALTERNATIVES, NOT THE ENDPOINT-LEVEL COMBINATOR
 *   `codegen/parameters.ts` resolves. MEASURED 2026-09-23 on pve-manager 9.2.11: six PVE SDN
 *   fabric request parameters (`delete`, `redistribute`, `interfaces` across the fabric and node
 *   write endpoints) and seven fabric return fields are each spelled `{oneOf: […], type: 'array',
 *   …}` with no outer `optional` — one branch per routing protocol (openfabric/bgp/ospf/
 *   wireguard) — and every branch says `optional: 1`. A reader that does not open `oneOf` sees
 *   `type: 'array'` alone and emits a REQUIRED field, which contradicts the vendor: a `bgp` fabric
 *   update never has to send `delete`.
 */
export interface VendorNode {
  readonly type?: string;
  readonly optional?: number | boolean;
  readonly enum?: readonly (string | number)[];
  readonly items?: VendorNode;
  readonly properties?: Readonly<Record<string, VendorNode>>;
  readonly additionalProperties?: number | boolean;
  readonly oneOf?: readonly VendorNode[];
}

/**
 * The wire spelling of a number: the TypeScript type `` `${number}` ``.
 *
 * ⚠️ WRITTEN AS A TEMPLATE LITERAL WITH ESCAPES, not as a quoted string. `'`${number}`'` is a
 *   plain string that merely LOOKS like an interpolation, which `no-template-curly-in-string`
 *   flags for exactly the reason it is usually a bug.
 */
export const NUMERIC_STRING = `\`\${number}\``;

/**
 * Whether a property is absent-safe: it says so itself, or — property-level `oneOf`, see the
 * interface above — every branch does. ⚠️ A SINGLE BRANCH WITHOUT `optional` KEEPS THE WHOLE
 * PROPERTY REQUIRED: `oneOf` branches are alternatives, not a vote, and a protocol that did not
 * mark its own branch optional has not told this generator it may be left out.
 */
export const isOptional = (node: VendorNode): boolean => {
  if (node.optional === 1 || node.optional === true) return true;
  const branches = node.oneOf;
  return Array.isArray(branches) && branches.length > 0 && branches.every(isOptional);
};

/**
 * ⛔ `enum: null` AND `properties: null` BOTH OCCUR. Measured on the whole of both schemas: the
 *   407-endpoint subset the old generator covered never hit one, so `node.enum !== undefined` was
 *   enough there and crashes here. `null` is not "an empty enum", it is the vendor saying nothing.
 */
const list = (value: VendorNode['enum']): readonly (string | number)[] | undefined =>
  Array.isArray(value) && value.length > 0 ? value : undefined;

const object = (
  value: VendorNode['properties'],
): Readonly<Record<string, VendorNode>> | undefined =>
  value !== null && typeof value === 'object' ? value : undefined;

/**
 * An `enum` is a closed set whatever the declared `type` is.
 *
 * ⚠️ PVE PUBLISHES TWO `type: 'integer'` PARAMETERS WITH AN ENUM, so the members are stringified
 *   before quoting. They travel as text like every other form value.
 */
const enumUnion = (values: readonly (string | number)[]): TsExpr =>
  union(values.map((value) => quote(String(value))));

/**
 * Every distinct member `inline()` would print, in first-seen order. A `union` expression is
 * flattened to its own parts (so alternatives across branches merge the way TypeScript's own
 * `A | B` would); anything else contributes its one printed form.
 */
const parts = (expr: TsExpr): readonly string[] =>
  expr.kind === 'union' ? expr.parts : [inline(expr)];

/**
 * An array's element type when a property-level `oneOf` (see `VendorNode`) stands in for `items`.
 * ⛔ ASSUME NOTHING: each branch is mapped by the SAME rule (`mapItem`, i.e. `paramType` or
 *   `returnType`) that would apply outside a `oneOf`, over that branch's OWN `items` — never the
 *   branch itself, which is `type: 'array'` too and would otherwise wrap the result an array deep.
 *   A branch that states no `items` of its own falls back to the existing default (`fallback`).
 * ★ THE RESULT IS THE UNION OF THOSE MAPPED TYPES, DEDUPLICATED IN SCHEMA ORDER — branch order,
 *   then member order within a branch — which is exactly what `A | B | C | D` prints to when A-D
 *   are themselves unions: TypeScript has no nested union, so flattening here changes nothing a
 *   compiler would not already do, and it keeps the printed type from repeating a member two
 *   protocols happen to share (PVE fabric `delete`: `route_filter` is in three branches).
 */
const oneOfItemType = (
  branches: readonly VendorNode[],
  mapItem: (node: VendorNode) => TsExpr,
  fallback: TsExpr,
): TsExpr => {
  const seen = new Set<string>();
  const flat: string[] = [];
  for (const branch of branches) {
    const type =
      branch.items === undefined || branch.items === null ? fallback : mapItem(branch.items);
    for (const part of parts(type)) {
      if (!seen.has(part)) {
        seen.add(part);
        flat.push(part);
      }
    }
  }
  return flat.length === 1 ? atom(flat[0] as string) : union(flat);
};

/** An array's element type: `items` when the vendor stated one, else its property-level `oneOf`. */
const arrayItemType = (
  node: VendorNode,
  mapItem: (node: VendorNode) => TsExpr,
  fallback: TsExpr,
): TsExpr => {
  if (node.items !== undefined && node.items !== null) return mapItem(node.items);
  const branches = node.oneOf;
  if (Array.isArray(branches) && branches.length > 0)
    return oneOfItemType(branches, mapItem, fallback);
  return fallback;
};

/** A request parameter's type. See the header: the wire is text, so every leaf is a string. */
export const paramType = (node: VendorNode): TsExpr => {
  const values = list(node.enum);
  if (values !== undefined) return enumUnion(values);
  if (node.type === 'boolean') return atom(`'0' | '1'`);
  if (node.type === 'array') {
    // ⚠️ AN ARRAY IS REPEATED KEYS ON THE WIRE, NOT A JSON LIST (client.ts `encode`). PBS builds
    //   its `Vec` from `delete=a&delete=b`; PVE takes a comma string and its callers pass one.
    return { item: arrayItemType(node, paramType, atom('string')), kind: 'array' };
  }
  if (node.type === 'integer' || node.type === 'number') return atom(NUMERIC_STRING);
  return atom('string');
};

/**
 * A response value's type.
 *
 * ⛔ THE RESPONSE IS JSON AND IS NOT WIDENED — it never was, and that asymmetry with the request
 *   side is real rather than an oversight. `guest: number` and `disable?: boolean | 0 | 1` are
 *   what the server sends.
 * ⚠️ `boolean | 0 | 1` RATHER THAN `boolean`, BECAUSE BOTH ARRIVE. PVE's Perl hands back `1` for
 *   some flags and `true` for others depending on the endpoint's serialiser; `values.ts`'s `bool`
 *   exists to accept the union, and a type claiming only `boolean` would make that helper's own
 *   argument a type error.
 */
export const returnType = (node: VendorNode | undefined): TsExpr => {
  if (node === undefined || node === null) return atom('unknown');
  const values = list(node.enum);
  if (values !== undefined) return enumUnion(values);
  if (node.type === 'null') return atom('null');
  if (node.type === 'array') {
    // ⚠️ ONE PVE ENDPOINT DECLARES `type: 'array'` WITH NO `items` AND NO `oneOf`. Measured on
    //   9.2.11; the element type is genuinely unstated, so it is `unknown` rather than an
    //   invented shape. `arrayItemType` falls through to the same `unknown` when that happens.
    return { item: arrayItemType(node, returnType, atom('unknown')), kind: 'array' };
  }
  const properties = object(node.properties);
  if (properties !== undefined) {
    const fields: TsField[] = Object.keys(properties)
      .sort()
      .map((name) => {
        const property = properties[name] as VendorNode;
        return { name, optional: isOptional(property), type: returnType(property) };
      });
    // ⛔ THE TWO PRODUCTS SPELL "CLOSED" DIFFERENTLY AND A TEST FOR ONE SILENTLY LIES ABOUT THE
    //   OTHER. Measured over both whole schemas, 2026-09-22: PVE writes NUMBERS (`0` on 617
    //   objects, `1` on 21, and nothing at all on 352 — Perl's JSON encoder), PBS writes BOOLEANS
    //   (`false` on 560, `true` on 36 — Rust's serde, which always emits the field). So
    //   `additionalProperties !== 0` alone would mark every one of PBS's 560 closed objects OPEN.
    // ⛔ AN ABSENT `additionalProperties` IS OPEN, NOT CLOSED. The vendor did not promise the list
    //   is exhaustive, and a closed type would let a consumer prove a field cannot arrive when it
    //   can. Only an explicit `0`/`false` closes the object.
    const closed = node.additionalProperties === 0 || node.additionalProperties === false;
    const open = !closed;
    // ⛔ `{}` IS NOT "THE EMPTY OBJECT" IN TYPESCRIPT — IT IS EVERY VALUE EXCEPT null AND undefined.
    //   A CLOSED object with no declared properties used to fall through to `{ fields: [] }` and
    //   render as `{}`, which typechecks against `42`, `'banana'` and `true`. That is WEAKER than
    //   `unknown`, which at least forces a narrowing before use, so the one place the vendor said
    //   least was the one place the generated type asserted nothing while looking specific.
    // ⚠️ ONE ENDPOINT HITS IT ON THESE VERSIONS: PBS `GET /nodes/{node}/disks/zfs/{name}` declares
    //   `properties: {}` and `additionalProperties: false` with the description "zpool vdev tree
    //   with status" — serde emits the `false` for a Rust field that is an untyped value, so the
    //   vendor's own prose says the payload is NOT empty. `Record<string, never>` would therefore
    //   be a claim its description contradicts, and the rule this file is built on is that only
    //   what the schema says gets asserted: `type: 'object'`, and nothing about the fields.
    if (fields.length === 0) return atom('Record<string, unknown>');
    return { fields, kind: 'object', open };
  }
  // ⚠️ `type: 'object'` WITH NO `properties` STATES NOTHING, so it is `unknown` and not
  //   `Record<string, unknown>` — the latter claims "an object", which the vendor did not say.
  if (node.type === 'string') return atom('string');
  if (node.type === 'integer' || node.type === 'number') return atom('number');
  if (node.type === 'boolean') return atom('boolean | 0 | 1');
  return atom('unknown');
};
