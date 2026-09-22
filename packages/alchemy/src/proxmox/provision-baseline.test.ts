/**
 * The baseline itself: the one privilege list, the generic defaults, and the names both halves
 * refuse before either can paste them into a root shell or a declaration.
 */
import { describe, expect, test } from 'bun:test';
import {
  PROVISION_DEFAULTS,
  PROVISION_PRIVILEGES,
  provisionBaseline,
} from './provision-baseline.ts';

describe('PROVISION_PRIVILEGES', () => {
  test('is 27 privileges, sorted, unique and frozen', () => {
    expect(PROVISION_PRIVILEGES).toHaveLength(27);
    expect([...PROVISION_PRIVILEGES].sort()).toEqual([...PROVISION_PRIVILEGES]);
    expect(new Set(PROVISION_PRIVILEGES).size).toBe(27);
    expect(Object.isFrozen(PROVISION_PRIVILEGES)).toBe(true);
  });

  test('holds what the lane needs to repair its own baseline (role.ts: no lock-out)', () => {
    for (const needed of [
      'Sys.Modify', // the role
      'Realm.AllocateUser', // the users
      'User.Modify',
      'Group.Allocate', // the mint group
      'Permissions.Modify', // the grants, and reading them at all (acl.ts)
    ]) {
      expect(PROVISION_PRIVILEGES).toContain(needed);
    }
  });
});

describe('provisionBaseline', () => {
  test('defaults: one role, one mint group, two lanes bound on /', () => {
    const baseline = provisionBaseline();
    expect(baseline.role).toEqual({ privs: PROVISION_PRIVILEGES, roleid: 'HfProvisioner' });
    expect(baseline.group).toEqual({ comment: PROVISION_DEFAULTS.comment, groupid: 'hf-mint' });
    expect(baseline.users.map((u) => [u.lane, u.userid, u.groups])).toEqual([
      ['provision', 'hf-provision@pve', ['hf-mint']],
      ['read', 'hf-read@pve', ['hf-mint']],
    ]);
    expect(baseline.grants).toEqual([
      { lane: 'provision', roleid: 'HfProvisioner', userid: 'hf-provision@pve' },
      { lane: 'read', roleid: 'PVEAuditor', userid: 'hf-read@pve' },
    ]);
  });

  test('a site passes its own names; an explicit undefined is the default', () => {
    const baseline = provisionBaseline({
      mintGroup: 'mint',
      provisionUser: 'provisioner@pve',
      readRole: 'Auditor',
      readUser: 'auditor@pve',
      role: undefined,
    });
    expect(baseline.role.roleid).toBe('HfProvisioner');
    expect(baseline.grants.map((g) => `${g.userid} ${g.roleid}`)).toEqual([
      'provisioner@pve HfProvisioner',
      'auditor@pve Auditor',
    ]);
    expect(baseline.users.every((u) => u.groups.join() === 'mint')).toBe(true);
  });

  test('readUser null is a baseline with no read lane', () => {
    const baseline = provisionBaseline({ readUser: null });
    expect(baseline.users.map((u) => u.lane)).toEqual(['provision']);
    expect(baseline.grants.map((g) => g.lane)).toEqual(['provision']);
  });

  test('refuses, all at once, every name that would need quoting or is not PVE-shaped', () => {
    const attempt = () =>
      provisionBaseline({
        comment: "it's",
        mintGroup: 'a b',
        provisionUser: 'no-realm',
        readRole: 'x;rm',
        readUser: 'q{}@pve',
        role: '$(id)',
      });
    expect(attempt).toThrow(/role `\$\(id\)`.*mintGroup `a b`.*readRole `x;rm`/);
    expect(attempt).toThrow(/provisionUser `no-realm`.*readUser `q\{\}@pve`.*comment/);
  });

  test('refuses one user for both lanes', () => {
    expect(() => provisionBaseline({ readUser: 'hf-provision@pve' })).toThrow(/one user/);
  });

  test('a comment per object, each defaulting to `comment` on its own', () => {
    // \u2605 THE EXISTING-CLUSTER CASE: the group and the read user already carry their own live
    //   comments, and only the provision user is new. One shared comment could not say this.
    const baseline = provisionBaseline({
      comment: 'shared',
      groupComment: '',
      provisionComment: 'mint target: provision (ops)',
      readComment: 'mint target: read (ops)',
    });
    expect(baseline.group.comment).toBe('');
    expect(baseline.users.map((u) => u.comment)).toEqual([
      'mint target: provision (ops)',
      'mint target: read (ops)',
    ]);
    // Overriding one leaves the others on `comment`; the generic case is still one string.
    const one = provisionBaseline({ comment: 'shared', provisionComment: 'only this' });
    expect([one.group.comment, ...one.users.map((u) => u.comment)]).toEqual([
      'shared',
      'only this',
      'shared',
    ]);
    expect(provisionBaseline({ comment: 'shared' }).group.comment).toBe('shared');
  });

  test('every comment is refused by its own field name', () => {
    const attempt = () =>
      provisionBaseline({ groupComment: "it's", provisionComment: 'q{x}', readComment: '$(id)' });
    expect(attempt).toThrow(/groupComment.*provisionComment.*readComment/);
  });

  test('readComment goes with its lane: unchecked, and unused, when readUser is null', () => {
    // ⚠️ Nothing would ever paste it, so refusing it would be a refusal over a field the caller
    //    is not using. The lane it belongs to is gone.
    const none = provisionBaseline({ readComment: "would need quoting'", readUser: null });
    expect(none.users.map((u) => u.lane)).toEqual(['provision']);
    expect(() => provisionBaseline({ readComment: "would need quoting'" })).toThrow(/readComment/);
  });
});
