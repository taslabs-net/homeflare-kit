/**
 * The vendor-schema-to-TypeScript mapping, pinned against the shapes the committed files already
 * had — and against the two places it deliberately stopped agreeing with them.
 *
 * ⛔ THIS IS THE PROOF THAT THE OLD GENERATOR WAS REPRODUCED BEFORE IT WAS CHANGED. There was no
 *   `codegen/generate.ts` at any commit, so the only statement of the old mapping was 8,196 lines
 *   of its own output. Every `expect` below is a shape lifted from that output, so the pipeline in
 *   codegen/ is held to what the cluster's types have always meant rather than to a snapshot of
 *   itself. Measured 2026-09-22: run with integers left widened, it re-emits all 646 PVE and 69
 *   PBS declarations identically bar the one nested-array case pinned here.
 *
 * ⚠️ NO SCHEMA FILE IS READ. The inputs are verbatim excerpts of pve-manager 9.2.11 and
 *   proxmox-backup-server 4.2.6-1, so this runs on CI where the 5.8 MB cache does not exist.
 */
import { describe, expect, test } from 'bun:test';
import { declaration } from '../codegen/tsexpr.ts';
import { NUMERIC_STRING, type VendorNode, paramType, returnType } from '../codegen/tsmap.ts';
import { typeName } from '../codegen/tsname.ts';

const asParam = (node: VendorNode): string =>
  declaration('T', paramType(node)).slice('export type T = '.length, -1);
const asReturn = (node: VendorNode | undefined): string =>
  declaration('T', returnType(node)).slice('export type T = '.length, -1);

describe('a request parameter is spelled the way the wire carries it', () => {
  test('a string stays a string and an enum stays its closed set', () => {
    expect(asParam({ type: 'string' })).toBe('string');
    expect(asParam({ enum: ['local', 'full'], type: 'string' })).toBe("'local' | 'full'");
  });

  /**
   * ⛔ THE DEFECT THIS GENERATOR EXISTS TO FIX. `pbs:POST /config/verify`'s `max-depth` is
   *   `type: integer, minimum: 0, maximum: 7` and the committed type said `'max-depth'?: string`,
   *   which accepted 'banana'. It is now the wire spelling of a number.
   * ⚠️ THE BOUNDS ARE NOT IN `VendorNode` BECAUSE THIS MAPPING DOES NOT READ THEM, and that is
   *   deliberate: `minimum` and `maximum` are enforced at plan time by the generated constraint
   *   tables. A type that claimed them would be claiming a check TypeScript cannot make.
   */
  test('an integer is a numeric string, not any string', () => {
    expect(asParam({ type: 'integer' })).toBe(NUMERIC_STRING);
    expect(asParam({ type: 'number' })).toBe(NUMERIC_STRING);
  });

  /**
   * ⚠️ NOT `boolean`, AND THAT IS NOT THE SAME KIND OF WIDENING. `client.ts` form-encodes the body
   *   and `values.ts`'s `flag()` produces exactly these two strings; a `boolean` here would be a
   *   type no form builder in this package could return.
   */
  test('a boolean is the 0/1 the form carries', () => {
    expect(asParam({ type: 'boolean' })).toBe("'0' | '1'");
  });

  test('an array is repeated keys, and keeps its items own type', () => {
    expect(asParam({ items: { type: 'string' }, type: 'array' })).toBe('readonly string[]');
    expect(
      asParam({ items: { enum: ['comment', 'disable'], type: 'string' }, type: 'array' }),
    ).toBe("readonly ('comment' | 'disable')[]");
  });

  /** ⚠️ `enum: null` OCCURS IN BOTH SCHEMAS and is the vendor saying nothing, not an empty set. */
  test('a null enum falls through to the declared type', () => {
    expect(asParam({ enum: null as unknown as string[], type: 'string' })).toBe('string');
  });
});

describe('a response is JSON and is not spelled for the wire', () => {
  test('numbers are numbers and booleans admit both spellings PVE sends', () => {
    expect(asReturn({ type: 'integer' })).toBe('number');
    expect(asReturn({ type: 'boolean' })).toBe('boolean | 0 | 1');
    expect(asReturn({ type: 'null' })).toBe('null');
  });

  /**
   * ⛔ THE TWO PRODUCTS SPELL "CLOSED" DIFFERENTLY: PVE writes `0`/`1`, PBS writes `false`/`true`.
   *   A test for one marks all 560 of the other's closed objects open.
   */
  test('only an explicit 0 or false closes an object', () => {
    const fields = { properties: { id: { type: 'string' } } } as const;
    expect(asReturn(fields)).toBe('{ id: string } & Record<string, unknown>');
    expect(asReturn({ ...fields, additionalProperties: 0 })).toBe('{ id: string }');
    expect(asReturn({ ...fields, additionalProperties: false })).toBe('{ id: string }');
    expect(asReturn({ ...fields, additionalProperties: 1 })).toBe(
      '{ id: string } & Record<string, unknown>',
    );
  });

  /** ⚠️ `type: 'object'` WITH NO `properties` STATES NOTHING — `unknown`, not an object type. */
  test('an object with nothing said about it is unknown, and an empty one is a record', () => {
    expect(asReturn({ type: 'object' })).toBe('unknown');
    expect(asReturn({ properties: {}, type: 'object' })).toBe('Record<string, unknown>');
    expect(asReturn(undefined)).toBe('unknown');
  });

  /**
   * 🔴 `{}` IS EVERY NON-NULLISH VALUE IN TYPESCRIPT, NOT THE EMPTY OBJECT. A closed object with no
   *   declared properties used to render as `{}`, and `const x: {} = 42` typechecks — so the one
   *   place the vendor documented least produced a type WEAKER than `unknown` while looking
   *   specific. Proven with tsc against the committed file before this changed.
   * ⚠️ `Record<string, never>` WOULD BE THE LITERAL READING AND IT WOULD BE FALSE. The only
   *   endpoint that hits this — PBS `GET /nodes/{node}/disks/zfs/{name}` — describes itself as
   *   "zpool vdev tree with status"; the `additionalProperties: false` is serde boilerplate for a
   *   Rust field holding an untyped value, not the vendor promising an empty payload.
   */
  test('a closed object with no properties is a record, never the bare {}', () => {
    const empty = { additionalProperties: false, properties: {}, type: 'object' } as const;
    expect(asReturn(empty)).toBe('Record<string, unknown>');
    expect(asReturn({ ...empty, additionalProperties: 0 })).toBe('Record<string, unknown>');
    expect(asReturn(empty)).not.toBe('{}');
  });

  test('an open object inside an array is parenthesised and a closed one is not', () => {
    const open = { items: { properties: { id: { type: 'string' } } }, type: 'array' } as const;
    expect(asReturn(open)).toBe('readonly ({ id: string } & Record<string, unknown>)[]');
    expect(asReturn({ ...open, items: { ...open.items, additionalProperties: 0 } })).toBe(
      'readonly { id: string }[]',
    );
  });

  /**
   * ⛔ THE ONE DELIBERATE DEPARTURE FROM THE COMMITTED SHAPES. `NodesNodeLxcVmidConfigGetReturn`'s
   *   `lxc` was `readonly string[][]` — a readonly array of MUTABLE arrays. Nothing mutates a
   *   response, and the inner array is as readonly as the outer one.
   */
  test('a nested array is readonly all the way down', () => {
    expect(asReturn({ items: { items: { type: 'string' }, type: 'array' }, type: 'array' })).toBe(
      'readonly (readonly string[])[]',
    );
  });
});

describe('names and layout reproduce the committed files', () => {
  /** ⚠️ SEGMENTS SPLIT ON `-` AND `.` BUT NOT `_`. Ugly, reproduced rather than renamed. */
  test('a path becomes the type name the committed file used', () => {
    expect(typeName('GET', '/cluster/backup/{id}/included_volumes', 'Return')).toBe(
      'ClusterBackupIdIncluded_volumesGetReturn',
    );
    expect(typeName('PUT', '/cluster/sdn/prefix-lists/{id}', 'Params')).toBe(
      'ClusterSdnPrefixListsIdPutParams',
    );
    expect(typeName('POST', '/pools', 'Params')).toBe('PoolsPostParams');
  });

  /** ⚠️ THE FIT TEST COUNTS THE TRAILING SEMICOLON. One column out is a 101-column line. */
  test('a declaration breaks at the print width, semicolon included', () => {
    const wide = declaration('ClusterSdnVnetsVnetSubnetsSubnetGetParams', {
      fields: [
        { name: 'pending', optional: true, type: paramType({ type: 'boolean' }) },
        { name: 'running', optional: true, type: paramType({ type: 'boolean' }) },
      ],
      kind: 'object',
      open: false,
    });
    expect(wide).toBe(
      "export type ClusterSdnVnetsVnetSubnetsSubnetGetParams = {\n  pending?: '0' | '1';\n  running?: '0' | '1';\n};",
    );
  });

  test('a union too long for one line breaks with a leading bar', () => {
    const long = declaration('T', {
      fields: [
        {
          name: 'log_level_forward',
          optional: true,
          type: paramType({
            enum: ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug', 'nolog'],
            type: 'string',
          }),
        },
      ],
      kind: 'object',
      open: false,
    });
    expect(long).toContain('  log_level_forward?:\n    | ');
    expect(long).toContain("\n    | 'nolog';");
  });
});
