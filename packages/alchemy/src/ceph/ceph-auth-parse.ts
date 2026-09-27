/**
 * Parsing for the three ceph `-f json` shapes `Ceph.AuthEntity` reads: `auth get`, `auth
 * get-or-create` and `quorum_status`. Pure: no I/O, tested with fixture stdout
 * (ceph-auth-parse.test.ts) — there is no live mon to capture real output from yet, so every shape
 * below is REASONED from public Ceph documentation, not measured, and an unexpected shape is
 * always an error, never a guess.
 *
 * ⛔ `parseAuthGet`'S RETURN TYPE HAS NO `key` FIELD. Decision 65 (2026-09-26, LAND finding 5)
 *   amended the design to let the observe step read `auth get`'s unfiltered stdout on every
 *   reconcile, not only on create — but the key it carries is dropped in the same breath:
 *   `parseKeyringEntry` reads it into a local binding and `parseAuthGet` never puts it in the
 *   object it returns. Not a convention, a type: there is no field here to forget to strip.
 * ⛔ `parseQuorumStatus` FAILS CLOSED. A JSON parse error, a missing `quorum` array or an empty one
 *   all answer `{ healthy: false }`; nothing here ever calls an unparseable answer healthy.
 */

export type CephCaps = { readonly mon: string; readonly osd: string; readonly mgr: string };

export type CephExecOutcome = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseCaps = (value: unknown, entity: string): CephCaps => {
  if (!isRecord(value)) throw new Error(`ceph auth: ${entity}'s entry has no caps object`);
  const { mon, osd, mgr } = value;
  if (typeof mon !== 'string' || typeof osd !== 'string' || typeof mgr !== 'string') {
    throw new Error(`ceph auth: ${entity}'s caps are missing a mon, osd or mgr string`);
  }
  return { mgr, mon, osd };
};

/**
 * REASONED shape (public `ceph auth get -f json` / `auth get-or-create -f json` docs): a JSON
 * array with one object per entity, `{entity, key, caps: {mon, osd, mgr}}`.
 */
const parseKeyringEntry = (
  stdout: string,
  entity: string,
): { readonly caps: CephCaps; readonly key: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (cause) {
    throw new Error(`ceph auth ${entity}: stdout did not parse as JSON (${String(cause)})`);
  }
  const row = Array.isArray(parsed)
    ? parsed.find((entry) => isRecord(entry) && entry['entity'] === entity)
    : undefined;
  if (!isRecord(row)) throw new Error(`ceph auth ${entity}: no matching entry in the JSON output`);
  const { key } = row;
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error(`ceph auth ${entity}: the entry has no key field`);
  }
  return { caps: parseCaps(row['caps'], entity), key };
};

export type CephAuthObserved =
  | { readonly kind: 'present'; readonly caps: CephCaps }
  | { readonly kind: 'absent' };

/**
 * ⚠️ ABSENCE IS RECOGNISED ONLY BY `ENOENT` IN STDERR (REASONED from `ceph auth get`'s documented
 *   error text). Any other nonzero exit — a permission problem, a malformed entity ceph itself
 *   refused, a mon mid-election — propagates as an error, never as "absent": the transient-read
 *   test every family in this kit carries.
 */
export const parseAuthGet = (result: CephExecOutcome, entity: string): CephAuthObserved => {
  if (result.exitCode !== 0) {
    if (result.stderr.includes('ENOENT')) return { kind: 'absent' };
    throw new Error(`ceph auth get ${entity} failed: ${result.stderr.trim().slice(0, 300)}`);
  }
  const { caps } = parseKeyringEntry(result.stdout, entity);
  return { caps, kind: 'present' };
};

/**
 * ⚠️ `get-or-create` NEVER READS AS ABSENT — REASONED: it either creates, returns the existing
 *   entity unchanged, or fails outright (e.g. an existing entity with different caps). A nonzero
 *   exit here is always an error.
 */
export const parseAuthGetOrCreate = (
  result: CephExecOutcome,
  entity: string,
): { readonly caps: CephCaps; readonly key: string } => {
  if (result.exitCode !== 0) {
    throw new Error(
      `ceph auth get-or-create ${entity} failed: ${result.stderr.trim().slice(0, 300)}`,
    );
  }
  return parseKeyringEntry(result.stdout, entity);
};

export type CephQuorum =
  | { readonly healthy: true }
  | { readonly healthy: false; readonly reason: string };

/** REASONED shape (public `ceph quorum_status -f json` docs): an object with a `quorum` array. */
export const parseQuorumStatus = (stdout: string): CephQuorum => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (cause) {
    return { healthy: false, reason: `stdout did not parse as JSON (${String(cause)})` };
  }
  if (!isRecord(parsed)) return { healthy: false, reason: 'stdout was not a JSON object' };
  const quorum = parsed['quorum'];
  return Array.isArray(quorum) && quorum.length > 0
    ? { healthy: true }
    : { healthy: false, reason: 'no non-empty `quorum` array in the quorum_status output' };
};
