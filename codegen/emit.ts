/**
 * Turning vendor parameters into the committed constraint table.
 *
 * ⛔ THE TABLE IS DATA AND THE FILE IS GENERATED, so the only hand-written thing here is the
 *   choice of WHICH rules survive. Everything that does survive is copied, never inferred: if the
 *   vendor did not state a bound, no bound is emitted, and the reader in
 *   `packages/alchemy/src/proxmox/constraints.ts` therefore cannot enforce one.
 */
import type { VendorEndpoint, VendorParam } from './apidoc.ts';
import { translatePattern } from './pattern.ts';

export interface EmittedParam {
  readonly type?: string;
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly string[];
  readonly pattern?: string;
  readonly patternSource?: string;
  readonly format?: string;
  readonly default?: string;
}

/** `{node}` in `/nodes/{node}/network`. */
const pathParams = (path: string): ReadonlySet<string> =>
  new Set([...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string));

/**
 * ⚠️ A PBS `format` IS AN OBJECT, A PVE `format` IS A STRING. Only the string is a validator NAME
 *   worth recording; the object is a sub-schema for the inside of a property string, and flattening
 *   it into this table would claim a rule about a field that is really a packed list.
 */
const formatName = (format: VendorParam['format']): string | undefined =>
  typeof format === 'string' ? format : undefined;

const scalarDefault = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined;

/**
 * ⚠️ BUILT AS A WIDER RECORD AND PRUNED, NOT AS AN `EmittedParam`. `exactOptionalPropertyTypes` is
 *   on, so an explicit `undefined` is not an absent key — and `prune` is what makes it one.
 */
const emitParam = (param: VendorParam, required: boolean): EmittedParam | undefined => {
  const translated = param.pattern === undefined ? undefined : translatePattern(param.pattern);
  const out: Record<string, unknown> = {
    default: scalarDefault(param.default),
    enum: param.enum,
    format: formatName(param.format),
    maxLength: param.maxLength,
    maximum: param.maximum,
    minLength: param.minLength,
    minimum: param.minimum,
    pattern: translated?.js,
    patternSource: param.pattern,
    required: required ? true : undefined,
    type: param.type,
  };
  // ⚠️ A row with only a `type` states nothing enforceable and nothing a reader needs; dropping it
  //   keeps the committed table to the rules that exist.
  const interesting = [
    'required',
    'maxLength',
    'minLength',
    'minimum',
    'maximum',
    'enum',
    'patternSource',
    'format',
  ].some((key) => out[key] !== undefined);
  return interesting ? prune(out) : undefined;
};

/** Drops the absent keys and sorts what is left, so the emitted table is byte-stable. */
const prune = (value: Record<string, unknown>): EmittedParam =>
  Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  ) as EmittedParam;

/**
 * One endpoint's constrained parameters, path segments removed.
 *
 * ⛔ A PATH PARAMETER IS NOT IN THE FORM. `spec.path(props)` builds `config/verify/v-r2-offsite`
 *   itself, so `{id}` never appears as a form key — and leaving it in the table would make every
 *   create refuse itself for a missing required parameter that was never missing.
 */
export const emitEndpoint = (endpoint: VendorEndpoint): Readonly<Record<string, EmittedParam>> => {
  const inPath = pathParams(endpoint.path);
  const rows: Record<string, EmittedParam> = {};
  for (const name of Object.keys(endpoint.params).sort()) {
    if (inPath.has(name)) continue;
    const param = endpoint.params[name];
    if (param === undefined) continue;
    const row = emitParam(param, param.optional !== 1 && param.optional !== true);
    if (row !== undefined) rows[name] = row;
  }
  return rows;
};

/**
 * The table's identity, independent of how the file is formatted.
 *
 * ★ A DIGEST OF THE DATA, NOT OF THE FILE TEXT, so `oxfmt` reflowing the generated literal does
 *   not read as a stale generation — while changing a single 128 to 129 by hand does.
 */
export const digest = (table: Readonly<Record<string, unknown>>): string =>
  new Bun.CryptoHasher('sha256')
    .update(JSON.stringify(sortedByKey(table)))
    .digest('hex')
    .slice(0, 16);

/**
 * ⛔ TOP-LEVEL KEYS SORTED BEFORE HASHING, because the generator builds the merged table per area
 *   and the published module spreads it per import — two different insertion orders over the same
 *   data. Without this the digest disagrees with itself and the staleness test fails on a repo
 *   that is perfectly current. (Parameter keys are already sorted by `emitEndpoint`.)
 */
export const sortedByKey = (
  table: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.keys(table)
      .sort()
      .map((key) => [key, table[key]]),
  );
