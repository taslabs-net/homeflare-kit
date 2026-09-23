/**
 * Property-level `oneOf`: a field the vendor spells as per-protocol alternatives rather than one
 * flat schema, and what that does to presence and to an array's element type.
 *
 * ⛔ THE DEFECT THIS FIXES. MEASURED 2026-09-23 against manifest `pve-apidoc` — pve-manager
 *   9.2.11/f6997e698c7933ea, sha256 9def8f13611184ee, read from a PVE cluster node's
 *   `/usr/share/pve-docs/api-viewer/apidoc.js`. Six PVE SDN fabric request parameters and seven
 *   fabric return fields (`delete`, `redistribute`, `interfaces` across the fabric and node write
 *   and read endpoints under `/cluster/sdn/fabrics`) are spelled `{oneOf: […], type: 'array'}`
 *   with no outer `optional` — one branch per routing protocol, every branch `optional: 1`.
 *   `codegen/tsmap.ts` read only the outer `optional`, saw none, and emitted every one of them
 *   REQUIRED — `delete: readonly string[]` — which a `bgp` fabric update never has to send.
 *
 * ⚠️ NO SCHEMA FILE IS READ. The fragments below are lifted from that cache, trimmed to the keys
 *   `codegen/tsmap.ts` actually reads (`type`, `optional`, `enum`, `items`, `oneOf`) — dropping
 *   `description`, `instance-types`, `type-property` and the nested `format` sub-schemas, none of
 *   which this generator consumes and all of which are therefore identical with or without them.
 *   So this runs on CI, where the 4.3 MB cache does not exist.
 */
import { describe, expect, test } from 'bun:test';
import type { VendorEndpoint, VendorParam } from '../codegen/apidoc.ts';
import { emitEndpoint } from '../codegen/emit.ts';
import { declaration } from '../codegen/tsexpr.ts';
import { type VendorNode, isOptional, paramType, returnType } from '../codegen/tsmap.ts';

const asParam = (node: VendorNode): string =>
  declaration('T', paramType(node)).slice('export type T = '.length, -1);
const asReturn = (node: VendorNode | undefined): string =>
  declaration('T', returnType(node)).slice('export type T = '.length, -1);

/** `PUT /cluster/sdn/fabrics/fabric/{id}` `delete` — pve-apidoc 9.2.11, all four branches. */
const FABRIC_DELETE = {
  oneOf: [
    {
      items: {
        enum: ['ip_prefix', 'ip6_prefix', 'hello_interval', 'csnp_interval', 'route_filter'],
        type: 'string',
      },
      optional: 1,
      type: 'array',
    },
    {
      items: {
        enum: [
          'ip_prefix',
          'ip6_prefix',
          'redistribute',
          'route_filter',
          'route_map_in',
          'route_map_out',
        ],
        type: 'string',
      },
      optional: 1,
      type: 'array',
    },
    {
      items: { enum: ['area', 'redistribute', 'route_filter'], type: 'string' },
      optional: 1,
      type: 'array',
    },
    { items: { enum: ['persistent_keepalive'], type: 'string' }, optional: 1, type: 'array' },
  ],
  type: 'array',
};

/**
 * `POST /cluster/sdn/fabrics/node/{fabric_id}` `interfaces` — pve-apidoc 9.2.11, all four
 * branches. ⚠️ THE FOURTH (bgp) BRANCH HAS `items` BUT NO `type` OF ITS OWN — verbatim; this
 * generator's array-item rule reads a branch's `items`, never a branch's own `type`.
 */
const NODE_INTERFACES = {
  oneOf: [
    { items: { format: { name: { type: 'string' } }, type: 'string' }, optional: 1, type: 'array' },
    { items: { format: { name: { type: 'string' } }, type: 'string' }, optional: 1, type: 'array' },
    {
      items: { format: 'pve-sdn-fabric-wireguard-interface', type: 'string' },
      optional: 1,
      type: 'array',
    },
    { items: { format: { name: { type: 'string' } }, type: 'string' }, optional: 1 },
  ],
  type: 'array',
};

/** `GET /cluster/sdn/fabrics/fabric/{id}` `redistribute` — a RETURN field, pve-apidoc 9.2.11. */
const FABRIC_REDISTRIBUTE_RETURN = {
  oneOf: [
    {
      items: {
        format: { source: { enum: ['bgp', 'connected', 'kernel', 'static'], type: 'string' } },
        type: 'string',
      },
      optional: 1,
      type: 'array',
    },
    {
      items: {
        format: { source: { enum: ['connected', 'kernel', 'ospf', 'static'], type: 'string' } },
        type: 'string',
      },
      optional: 1,
      type: 'array',
    },
  ],
  type: 'array',
};

describe('a property-level oneOf (PVE SDN fabrics, 9.2.11) decides presence', () => {
  test('every branch optional makes the property optional, for a param and for a return field', () => {
    expect(isOptional(FABRIC_DELETE)).toBe(true);
    expect(isOptional(NODE_INTERFACES)).toBe(true);
    expect(isOptional(FABRIC_REDISTRIBUTE_RETURN)).toBe(true);
  });

  /**
   * ⛔ NOT A VOTE. `oneOf` branches are alternatives, and a protocol that never marked its own
   *   branch optional has not told this generator the property may be left out for it.
   */
  test('one branch without optional keeps the whole property required', () => {
    const fixture = {
      oneOf: [
        { items: { type: 'string' }, optional: 1, type: 'array' },
        { items: { type: 'string' }, type: 'array' },
      ],
      type: 'array',
    };
    expect(isOptional(fixture)).toBe(false);
  });

  /** ⚠️ AN EMPTY oneOf IS NOT "EVERY BRANCH AGREES" — there is no branch to agree. */
  test('an empty oneOf does not make a property optional', () => {
    expect(isOptional({ oneOf: [], type: 'array' })).toBe(false);
  });
});

describe('the element type, when items lives only in the branches', () => {
  /**
   * ⛔ THIS FAILS ON MAIN. Today `delete` has no top-level `items`, so the old rule fell back to
   *   plain `string` — losing every enum member the vendor actually states per protocol.
   */
  test('delete is the union of what each branch itself states, deduplicated in schema order', () => {
    expect(asParam(FABRIC_DELETE)).toBe(
      "readonly (\n  | 'ip_prefix'\n  | 'ip6_prefix'\n  | 'hello_interval'\n  | 'csnp_interval'\n  | 'route_filter'\n  | 'redistribute'\n  | 'route_map_in'\n  | 'route_map_out'\n  | 'area'\n  | 'persistent_keepalive')[]",
    );
  });

  /**
   * Every branch's own `items` maps to plain `string` here (none states an `enum`; the per-source
   * detail lives in `format`, which this generator does not read) — so the branches agree and the
   * union collapses to the one type, not a four-way repetition of `string`.
   */
  test('interfaces is optional readonly string[], the bgp branch (no outer type) included', () => {
    expect(asParam(NODE_INTERFACES)).toBe('readonly string[]');
  });

  /** The same branch-union rule applies on the response side, through `returnType`. */
  test('a return field with property-level oneOf gets its element type the same way', () => {
    expect(asReturn(FABRIC_REDISTRIBUTE_RETURN)).toBe('readonly string[]');
  });

  /**
   * A branch with no `items` of its own falls back to the ordinary per-side default — `string`
   * for a param, which agrees with the other branch's own `string` and collapses to one type;
   * `unknown` for a return, which does NOT agree with the other branch's `string` and stays a
   * union of the two.
   */
  test('a branch with no items of its own falls back: string for params, unknown for returns', () => {
    const noItems = {
      oneOf: [
        { optional: 1, type: 'array' },
        { items: { type: 'string' }, optional: 1, type: 'array' },
      ],
      type: 'array',
    };
    expect(asParam(noItems)).toBe('readonly string[]');
    expect(asReturn(noItems)).toBe('readonly (unknown | string)[]');
  });
});

/**
 * The same fragment through `emit.ts`, which tables required-ness separately from `tsmap.ts` for
 * the generated constraint files a plan-time guard reads. ⛔ THIS FAILS ON MAIN: the old
 * `param.optional !== 1 && param.optional !== true` line 129 read only the outer key too, so this
 * row came out `required: true` — a future fabric Resource's create form would be refused for
 * omitting `delete` on a `bgp` fabric, which the vendor never requires.
 */
describe('emit.ts tables the same presence rule for the constraint files', () => {
  test('a oneOf property whose every branch is optional is not tabled as required', () => {
    const endpoint: VendorEndpoint = {
      method: 'PUT',
      params: { delete: FABRIC_DELETE as VendorParam },
      path: '/cluster/sdn/fabrics/fabric/{id}',
    };
    const rows = emitEndpoint(endpoint, 'pve');
    expect(rows['delete']?.required).toBeUndefined();
  });
});
