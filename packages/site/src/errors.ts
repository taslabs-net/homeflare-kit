/**
 * The one error this package throws.
 *
 * ★ ONE CLASS, A `code` TO SWITCH ON. Callers mostly print the message and stop; the few
 *   that branch (a scaffold harness skipping `derive-version` in a dry run, say) branch on
 *   `code`, which is stable, rather than on message text, which is not.
 *
 * ⛔ Messages name paths, keys and the fix — never a value from a live file beyond the
 *   one being complained about. A site file is private, and an error string ends up in CI
 *   logs.
 */

export type SiteErrorCode =
  /** The file does not match the schema. `issues` lists `path: problem`. */
  | 'decode'
  /** A value points at something the file does not declare (a zone, host, network). */
  | 'reference'
  /** A consumer asked for a product, service, zone, host or pin nobody declared. */
  | 'unknown-key'
  /** The file was reviewed against a different `@homeflare/site` version. */
  | 'derive-version'
  /** A non-live site was asked to plan stage `live`. */
  | 'stage'
  /** The observed vault or account is not the one the site describes. */
  | 'identity'
  /** The file could not be located, read or parsed. */
  | 'load'
  /** The file is not committed on `main` and `siteDev` was not set. */
  | 'checkout'
  /** An environment override was refused. */
  | 'override';

export class SiteError extends Error {
  override readonly name = 'SiteError';
  readonly code: SiteErrorCode;
  /** One line per problem, each naming its path. Empty when the message says it all. */
  readonly issues: readonly string[];

  constructor(code: SiteErrorCode, message: string, issues: readonly string[] = []) {
    super(issues.length === 0 ? message : `${message}\n  ${issues.join('\n  ')}`);
    this.code = code;
    this.issues = issues;
  }
}

/** Throw `unknown-key`, listing what IS declared so the fix is one glance away. */
export function unknownKey(kind: string, key: string, declared: Iterable<string>): never {
  const known = [...declared].sort();
  const list = known.length === 0 ? 'none are declared' : `declared: ${known.join(', ')}`;
  throw new SiteError('unknown-key', `unknown ${kind} "${key}" (${list})`);
}

/**
 * Look a key up in a record, or throw `unknown-key`.
 * ⛔ No fallback, ever. A plausible default host is how a typo becomes a live DNS record.
 */
export function lookup<V>(kind: string, record: Readonly<Record<string, V>>, key: string): V {
  if (!Object.hasOwn(record, key)) unknownKey(kind, key, Object.keys(record));
  return record[key] as V;
}
