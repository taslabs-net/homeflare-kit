/**
 * The `ceph config get/set/rm` half of the argv allowlist — split out of ceph-argv.ts (which
 * re-exports `configProblem`) purely to keep that file under the house's 250-line file cap; the
 * split follows the same line the design docs already draw (2026-09-26-ceph-config-options.md is
 * its own companion to 2026-09-26-ceph-mon-transport.md).
 *
 * ⚠️ `<who>` IS NOT YET BOUNDED TO K-D's "declared daemons" (the config-options design's own
 *   acceptance test #1). `client.admin` still matches this shape. Latent today:
 *   `NAMED_CONFIG_OPTIONS` starts empty, so `namedOptionProblem` refuses every `config get/set/rm`
 *   regardless of `who` — LAND red team, 2026-09-26, flagged this as armed only once K-D's first
 *   named option lands, and narrowing it needs that family's own declared-daemon list, which does
 *   not exist yet. Tracked for `CephConfigOption` (K-D), not fixed here.
 */
import { NAMED_CONFIG_OPTIONS, isLockoutConfigOption } from './ceph-config-options.ts';

/** `config`'s `<who>`: a daemon class, optionally `.id` — never a path, never free text. */
const WHO = /^(global|mon|osd|mgr|mds|client)(\.[A-Za-z0-9_-]{1,32})?$/;
/** A ceph option name's own shape — snake_case, lowercase. Independent of the named list below. */
const OPTION_NAME = /^[a-z][a-z0-9_]{0,63}$/;
/**
 * No shell metacharacters; the named list (below) is what actually decides secrecy, not this.
 * ⛔ NO LEADING `-` EXCEPT A NEGATIVE INTEGER, AND NEVER EMPTY. LAND red team (2026-09-26),
 *   CONFIRMED: the prior pattern let a config VALUE start with `-`, and this argv reaches
 *   `sudo -n /usr/bin/ceph` with no shell in between — no shell means no quoting boundary, so
 *   `ceph config set global x -o/etc/ceph/ceph.conf` parses as ceph's own `-o <file>` flag, not
 *   as the string `-o/etc/ceph/ceph.conf`. Accepted flag-shaped values included
 *   `--admin-daemon=/var/run/ceph/ceph-mon.a.asok`, `--conf=/tmp/x`, `-n`, and the empty string.
 *   The sudoers entry has no argument restriction of its own (that is D4, a later step), so this
 *   allowlist is the only thing standing between a config value and an arbitrary ceph CLI flag.
 *   Latent while `NAMED_CONFIG_OPTIONS` is empty; K-D's first entry arms it.
 */
const CONFIG_VALUE = /^(?:[A-Za-z0-9][A-Za-z0-9 ._:/=,-]{0,255}|-[0-9]{1,255})$/;

/**
 * `undefined` when `value` is a safe ceph config value — exported (like `boundedEntityProblem`)
 * so the shape itself is directly testable, since `NAMED_CONFIG_OPTIONS` being empty today means
 * `cephCommandProblem` never reaches this check on any real argv (`namedOptionProblem` refuses
 * first) — this stays exercised until K-D's first named option arms the path for real.
 */
export const configValueProblem = (value: string): string | undefined =>
  CONFIG_VALUE.test(value)
    ? undefined
    : `config value ${JSON.stringify(value)} contains characters outside the safe set`;

/**
 * `undefined` when `name` may be declared, adopted, read by value or written — see
 * ceph-config-options.ts's header for why the list starts empty and stays reviewed line by line.
 */
const namedOptionProblem = (name: string): string | undefined => {
  if (!OPTION_NAME.test(name)) return `${JSON.stringify(name)} is not a plain ceph option name`;
  if (isLockoutConfigOption(name))
    return `${name} is a lockout-class option and can never be declared`;
  return NAMED_CONFIG_OPTIONS.has(name)
    ? undefined
    : `${name} is not on the named option list (it starts empty — see ceph-config-options.ts)`;
};

/** `config get|set|rm <who> <name> [value]`, called with the operands after `config` stripped. */
export const configProblem = (rest: readonly string[]): string | undefined => {
  const [verb, who, name, ...extra] = rest;
  if (who === undefined || !WHO.test(who)) {
    return 'config takes a bounded `<who>` (global/mon/osd/mgr/mds/client[.id])';
  }
  if (name === undefined) return 'config takes a `<name>` from the named option list';
  if (verb === 'get' || verb === 'rm') {
    return extra.length === 0
      ? namedOptionProblem(name)
      : `config ${String(verb)} takes exactly \`<who> <name>\``;
  }
  if (verb === 'set') {
    const [value, ...more] = extra;
    if (value === undefined || more.length !== 0)
      return 'config set takes exactly `<who> <name> <value>`';
    const named = namedOptionProblem(name);
    return named !== undefined ? named : configValueProblem(value);
  }
  return `ceph config ${String(verb)} is not on the allowlist`;
};
