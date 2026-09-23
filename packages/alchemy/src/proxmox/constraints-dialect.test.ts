/**
 * The two rule kinds the first generation dropped, and the false positive neither may cause.
 *
 * 🔴 ADVERSARIAL REVIEW OF THE 2026-09-22 CONSTRAINT GUARD, SAME DAY. The guard caught the
 *   128-character comment, and two whole rule kinds were passing through it unchecked:
 *   - PVE applies `m/^$pattern$/` (MEASURED in JSONSchema.pm:1636) and the table carried the
 *     UNANCHORED body, so `RegExp.test` searched: a firewall alias named `ok name!` matched on
 *     `ok`, passed plan, and was rejected by PVE with the 400 this feature exists to prevent.
 *   - An array parameter states its rules on `items`, and the emitter read only the parameter,
 *     so `target`, `associated-key` and `secondary-controllers` were tabled with no rule at all —
 *     while `violations` was already checking every element against that empty rule.
 *
 * ★ EVERY CASE HERE IS A MUTANT: it passes on the fixed generator and fails on the one that
 *   shipped. The last describe is the opposite risk and the more dangerous one — a rule that
 *   refuses a declaration the vendor ACCEPTS breaks a stack that was always legal.
 */
import { describe, expect, test } from 'bun:test';
import { constraintsFor, formViolations } from './constraint-guard.ts';
import { matcherCreateForm, matcherUpdateForm } from './notification-matcher-form.ts';

const ALIAS = 'pve:POST /cluster/firewall/aliases';
const PBS_MATCHER = 'pbs:POST /config/notifications/matchers';
const PBS_MATCHER_PUT = 'pbs:PUT /config/notifications/matchers/{name}';
const PVE_MATCHER = 'pve:POST /cluster/notifications/matchers';
const BACKUP = 'pve:POST /cluster/backup';

describe('a PVE pattern is anchored the way PVE anchors it', () => {
  /**
   * ⛔ THE MUTANT. `[A-Za-z][A-Za-z0-9\-\_]+` unanchored matches the `ok` inside `ok name!`, so
   *   `RegExp.test` said yes and PVE said 400. Deleting the `^`/`$` in param-rules.ts brings this
   *   failure back exactly.
   */
  test('a name PVE rejects is refused, not matched on its prefix', () => {
    expect(formViolations(ALIAS, { cidr: '10.0.0.0/24', name: 'ok-name' }, false)).toEqual([]);
    expect(formViolations(ALIAS, { cidr: '10.0.0.0/24', name: 'ok name!' }, false)).toEqual([
      'name: must match [A-Za-z][A-Za-z0-9\\-\\_]+',
    ]);
  });

  /** The violation quotes the VENDOR's spelling, so an operator can search PVE's own docs for it. */
  test('the message is the vendor pattern, never the anchored translation', () => {
    const rule = constraintsFor(ALIAS)['name'];
    expect(rule?.pattern).toBe('^[A-Za-z][A-Za-z0-9\\-\\_]+\\n?$');
    expect(rule?.patternSource).toBe('[A-Za-z][A-Za-z0-9\\-\\_]+');
  });

  /**
   * ⚠️ PERL'S `$`, NOT JAVASCRIPT'S. `m/^x$/` matches `"x\n"`; a bare `$` in JavaScript does not.
   *   Without the `\n?` this line would be a refusal of a value PVE accepts — the false positive
   *   that is worse than the server 400 it replaces.
   */
  test('a trailing newline is accepted, because Perl accepts it', () => {
    expect(formViolations(BACKUP, { starttime: '02:00\n' }, false)).toEqual([]);
    expect(formViolations(BACKUP, { starttime: '02:00' }, false)).toEqual([]);
    expect(formViolations(BACKUP, { starttime: 'at 02:00' }, false)).toEqual([
      'starttime: must match \\d{1,2}:\\d{1,2}',
    ]);
  });

  /** ⚠️ PBS patterns already carry their own `^…$`; anchoring them again would invent a rule. */
  test('a PBS pattern is left exactly as the vendor wrote it', () => {
    const rule = constraintsFor(PBS_MATCHER)['name'];
    expect(rule?.pattern).toBe('^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$');
    expect(rule?.patternSource).toStartWith('/^');
  });
});

describe("an array's rules come from its items, and reach every element", () => {
  const fields = (targets: readonly string[]) => ({ name: 'default-matcher', targets });

  test('PBS bounds each target name, and the table says the rule is per element', () => {
    const rule = constraintsFor(PBS_MATCHER)['target'];
    expect(rule).toMatchObject({ each: true, maxLength: 32, minLength: 2, type: 'array' });
  });

  test('one over-long element is refused although the parameter is a list', () => {
    expect(formViolations(PBS_MATCHER, matcherCreateForm(fields(['mail-to-root'])), false)).toEqual(
      [],
    );
    expect(formViolations(PBS_MATCHER, matcherCreateForm(fields(['m'.repeat(33)])), false)).toEqual(
      ['target: at most 32 characters'],
    );
    // ⚠️ AND THE SHORT ONE TOO: `minLength` on an element is the bound a joined string would hide.
    expect(formViolations(PBS_MATCHER, matcherCreateForm(fields(['m'])), false)).toEqual([
      'target: at least 2 characters',
    ]);
  });

  /**
   * ⛔ `delete` IS AN ARRAY OF AN ENUM ON PBS, and `matcherUpdateForm` fills it from its own
   *   `Deletable` union. This is the one place the two could drift: a member this package clears
   *   that PBS does not accept is a 400 the vendor's own enum can refuse at plan time.
   */
  test("the update form's cleared fields are all members of PBS's own delete enum", () => {
    const form = matcherUpdateForm({ comment: '', name: 'default-matcher', targets: [] });
    expect(form.delete).toEqual([
      'match-calendar',
      'match-field',
      'match-severity',
      'target',
      'comment',
    ]);
    expect(formViolations(PBS_MATCHER_PUT, form, false)).toEqual([]);
  });

  /** PVE spells the same list with `format: pve-configid`, which is a NAME and stays unchecked. */
  test('a PVE element rule with only a format is recorded and not enforced', () => {
    expect(constraintsFor(PVE_MATCHER)['target']).toMatchObject({
      each: true,
      format: 'pve-configid',
    });
    expect(formViolations(PVE_MATCHER, matcherCreateForm(fields(['m'.repeat(80)])), false)).toEqual(
      [],
    );
  });
});

/**
 * 🔴 `Proxmox.HaRule`'s TABLE WAS EMPTY AND NOTHING SAID SO. PVE spells `POST /cluster/ha/rules`
 *   as `allOf: [{properties: {rule}}, {oneOf: [node-affinity, resource-affinity]}]`, the reader
 *   asked for `parameters.properties`, got `undefined`, and emitted `{}` — which is exactly what
 *   an endpoint with no rules emits. A wired family's guard checked nothing, silently.
 */
describe('a parameter schema wrapped in allOf/oneOf is read, not skipped', () => {
  const CREATE = 'pve:POST /cluster/ha/rules';

  test('the table is no longer empty, and carries the limits both branches agree on', () => {
    const table = constraintsFor(CREATE);
    expect(Object.keys(table).sort()).toEqual(['affinity', 'comment', 'resources', 'rule']);
    expect(table['comment']).toMatchObject({ maxLength: 4096 });
    expect(table['affinity']).toMatchObject({ enum: ['positive', 'negative'] });
  });

  /**
   * ⛔ `nodes` AND `strict` EXIST ONLY ON THE node-affinity BRANCH, so enforcing them would refuse
   *   a resource-affinity rule for breaking a rule PVE never applies to it. `oneOf` intersects.
   */
  test('a rule only one branch states is NOT enforced', () => {
    expect(constraintsFor(CREATE)['nodes']).toBeUndefined();
    expect(constraintsFor(CREATE)['strict']).toBeUndefined();
  });

  /**
   * ⚠️ `affinity` IS REQUIRED ON resource-affinity AND OPTIONAL ON node-affinity, so presence is
   *   not enforced. Dropping a disagreeing `optional` would have read as REQUIRED — absence means
   *   required in this schema — and refused every legal node-affinity rule.
   */
  test('presence is required only where every branch requires it', () => {
    const table = constraintsFor(CREATE);
    expect(table['rule']?.required).toBe(true);
    expect(table['resources']?.required).toBe(true);
    expect(table['affinity']?.required).toBeUndefined();
    expect(formViolations(CREATE, { affinity: 'positive', resources: 'vm:100' }, true)).toEqual([
      'rule: required',
    ]);
  });

  test('the live shape of a node-affinity rule has no violations', () => {
    const form = { affinity: 'positive', nodes: 'n1:2,n2:1', resources: 'vm:100', rule: 'pin-100' };
    expect(formViolations(CREATE, form, true)).toEqual([]);
    expect(formViolations(CREATE, { ...form, comment: 'c'.repeat(4097) }, true)).toEqual([
      'comment: at most 4096 characters',
    ]);
  });
});
