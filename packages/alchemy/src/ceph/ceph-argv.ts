/**
 * The client-side argv allowlist for the Ceph mon-command transport (K-A4) — an allowlist of
 * SHAPES, not of subcommands, the same discipline `../linux/sudo-allowlist.ts` uses for the file
 * family. Pure: no I/O, so every shape is tested without ssh (ceph-argv.test.ts).
 *
 * Design: docs/plans/2026-09-26-ceph-mon-transport.md ("Transport options", T-A) and
 * docs/plans/2026-09-26-ceph-config-options.md (the named option list this file bounds `config`
 * to). Both are REASONED against public Ceph docs, not measured on this estate's cluster — no
 * mon exists yet for a live check, which is exactly why every shape here is bounded as tightly as
 * the design allows rather than merely "shaped like a ceph command".
 *
 * ⛔ `auth ls` IS NEVER ALLOWED. It prints every key on the cluster, and the estate's own
 *   2026-09-25 lesson is that an exclusion filter is how a token leaks — allowlist extraction
 *   only, never "everything except". A caller that wants an inventory uses the committed
 *   read-only script this design defers to, never this transport.
 * ⛔ `auth del` IS NEVER ALLOWED, PERIOD — not behind a flag, not for any entity. The lockout-safety
 *   rule is "never auto-delete" (D3): a wrong delete here de-authenticates whatever the entity's
 *   caps still let VM disks depend on, and it does not ask twice.
 * ⛔ THE ENTITY OPERAND IS BOUNDED TO THE `client.k8s-` PREFIX. `client.admin`, `mon.*`, `osd.*`,
 *   `mgr.*` and the PVE storage client are the keyrings the cluster and every VM disk run on;
 *   nothing this allowlist accepts can name one.
 * ⛔ EVERY CHECK RUNS AGAINST THE FINAL ARGV — `/usr/bin/ceph`, the real subcommand, and the
 *   trailing `-f json` the transport always appends — never a pre-transform version, so what is
 *   validated is exactly what reaches `sudo -n`.
 */
import { configProblem } from './ceph-argv-config.ts';

export { configValueProblem } from './ceph-argv-config.ts';

/** ★ Absolute, so neither sudo nor `ceph` is looked up on the operator's PATH. */
export const CEPH_BIN = '/usr/bin/ceph';

/** Every entity this transport may ever touch starts with this. */
export const ENTITY_PREFIX = 'client.k8s-';

/** ⚠️ Bounded length too — a cap operand this long is not a plausible pool-scoped rbd profile. */
const ENTITY = /^client\.k8s-[a-z0-9][a-z0-9-]{0,61}$/;

/** `undefined` when `entity` is a name this transport may ever create, get or re-cap. */
export const boundedEntityProblem = (entity: string): string | undefined =>
  ENTITY.test(entity)
    ? undefined
    : `entity must match \`${ENTITY_PREFIX}<name>\` (lowercase, digits, hyphens), got ${JSON.stringify(entity)}`;

/**
 * ⛔ THE DESIGN'S OWN CAPS, LITERALLY — NOT A GENERAL "LOOKS LIKE A CAP STRING" GRAMMAR. LAND red
 *   team (2026-09-26), CONFIRMED: an earlier, wider pattern here (any of `[A-Za-z0-9 _.=,-]`, no
 *   per-daemon shape) also matched `allow rwx`, bare `profile osd` / `profile bootstrap-osd`,
 *   comma-chained grants (`profile rbd pool=k8s-rbd, allow rwx`), and — the sharpest one — an osd
 *   `profile rbd` with NO pool, which grants rbd access to every pool on the cluster, the VM-disk
 *   pool included. The design (2026-09-26-ceph-mon-transport.md, "Props") only ever declares
 *   `mon: 'profile rbd'` and `osd`/`mgr: 'profile rbd pool=<name>'`; these are that shape, exactly,
 *   pool name bounded the same way an entity name is.
 */
const MON_CAP = /^profile rbd$/;
const POOL_SCOPED_CAP = /^profile rbd pool=[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

const DAEMONS = ['mon', 'osd', 'mgr'] as const;

/** `undefined` when `value` is `daemon`'s one allowed cap shape (the design's own caps map). */
const capProblem = (
  daemon: (typeof DAEMONS)[number],
  value: string | undefined,
): string | undefined => {
  if (value === undefined) return `${daemon} cap is missing`;
  const shape = daemon === 'mon' ? MON_CAP : POOL_SCOPED_CAP;
  return shape.test(value)
    ? undefined
    : `${daemon} cap ${JSON.stringify(value)} is not the design's plain pool-scoped rbd profile`;
};

/** `auth get <entity>`: the read `Ceph.AuthEntity` uses to observe caps, never the key. */
const authGetProblem = (ops: readonly string[]): string | undefined => {
  const [entity, ...extra] = ops;
  if (entity === undefined || extra.length !== 0) return 'auth get takes exactly `<entity>`';
  return boundedEntityProblem(entity);
};

/**
 * `auth get-or-create <entity> mon <cap> osd <cap> mgr <cap>` and `auth caps` (same operand
 * shape). ★ FIXED ORDER, EXACTLY THREE PAIRS — the design's own caps map is always
 *   `{mon, osd, mgr}`; a variable-length daemon list is more allowlist than this family needs,
 *   and less allowlist is less to get wrong.
 */
const capsTripleProblem = (ops: readonly string[]): string | undefined => {
  const [entity, ...pairs] = ops;
  if (entity === undefined)
    return `takes exactly \`<entity> ${DAEMONS.map((d) => `${d} <cap>`).join(' ')}\``;
  const entityProblem = boundedEntityProblem(entity);
  if (entityProblem !== undefined) return entityProblem;
  if (pairs.length !== DAEMONS.length * 2) {
    return `takes exactly \`<entity> ${DAEMONS.map((d) => `${d} <cap>`).join(' ')}\``;
  }
  for (const [index, daemon] of DAEMONS.entries()) {
    const key = pairs[index * 2];
    const value = pairs[index * 2 + 1];
    if (key !== daemon)
      return `expected \`${daemon}\` in position ${String(index + 1)}, got ${JSON.stringify(key)}`;
    const problem = capProblem(daemon, value);
    if (problem !== undefined) return problem;
  }
  return undefined;
};

const authProblem = (rest: readonly string[]): string | undefined => {
  const [verb, ...ops] = rest;
  if (verb === 'ls') {
    return (
      'auth ls prints every key on the cluster; use the committed read-only inventory ' +
      'script instead, never this transport'
    );
  }
  if (verb === 'del')
    return 'auth del is refused entirely — lockout safety, never auto-delete (D3)';
  if (verb === 'get') return authGetProblem(ops);
  if (verb === 'get-or-create') return capsTripleProblem(ops);
  if (verb === 'caps') return capsTripleProblem(ops);
  return `ceph auth ${String(verb)} is not on the allowlist`;
};

/** Every call this allowlist accepts ends in this — the transport appends it, never the caller. */
const JSON_FORMAT = ['-f', 'json'] as const;

const withJsonSuffix = (
  rest: readonly string[],
  check: (ops: readonly string[]) => string | undefined,
): string | undefined => {
  const suffix = rest.slice(-2);
  if (suffix[0] !== JSON_FORMAT[0] || suffix[1] !== JSON_FORMAT[1]) {
    return 'every ceph call in this allowlist ends `-f json`';
  }
  return check(rest.slice(0, -2));
};

/**
 * `undefined` when `argv` is exactly an allowed ceph shape (the FULL argv `sudo -n` would run,
 * `/usr/bin/ceph` included), else the reason it is not.
 */
export const cephCommandProblem = (argv: readonly string[]): string | undefined => {
  const [bin, group, ...rest] = argv;
  if (bin !== CEPH_BIN) return `${JSON.stringify(bin)} is not the allowlisted ceph binary`;
  if (group === 'quorum_status') {
    return rest.length === 2 && rest[0] === JSON_FORMAT[0] && rest[1] === JSON_FORMAT[1]
      ? undefined
      : 'quorum_status takes exactly `-f json`';
  }
  if (group === 'auth') return withJsonSuffix(rest, authProblem);
  if (group === 'config') return withJsonSuffix(rest, configProblem);
  return `ceph ${String(group)} is not on the allowlist`;
};

/** The exact argv for each allowed shape, so callers never hand-assemble one that could drift. */
export const authGetArgv = (entity: string): readonly string[] => [
  CEPH_BIN,
  'auth',
  'get',
  entity,
  ...JSON_FORMAT,
];

export const authGetOrCreateArgv = (
  entity: string,
  caps: Readonly<Record<(typeof DAEMONS)[number], string>>,
): readonly string[] => [
  CEPH_BIN,
  'auth',
  'get-or-create',
  entity,
  ...DAEMONS.flatMap((daemon) => [daemon, caps[daemon]]),
  ...JSON_FORMAT,
];

export const authCapsArgv = (
  entity: string,
  caps: Readonly<Record<(typeof DAEMONS)[number], string>>,
): readonly string[] => [
  CEPH_BIN,
  'auth',
  'caps',
  entity,
  ...DAEMONS.flatMap((daemon) => [daemon, caps[daemon]]),
  ...JSON_FORMAT,
];

export const quorumStatusArgv = (): readonly string[] => [
  CEPH_BIN,
  'quorum_status',
  ...JSON_FORMAT,
];
