/**
 * The generated bootstrap, RUN: under `sh`, with real Perl, against provision-cli-fake.ts's
 * `pvesh`/`pveum`. What these pin: a fresh cluster gets exactly the baseline in an order PVE accepts;
 * a second run (or a node joining a cluster that has it) writes nothing; drift converges with only
 * the writes it needs; a read role that is missing stops the script before any write; and the
 * script never makes a token or sets a password.
 */
import { describe, expect, test } from 'bun:test';
import { type CliState, freshCluster, runScript } from './provision-cli-fake.ts';
import { PROVISION_DEFAULTS, PROVISION_PRIVILEGES } from './provision-baseline.ts';
import { provisionBootstrap } from './provision-bootstrap.ts';

const COMMENT = PROVISION_DEFAULTS.comment;
const lane = (groups: string[]) => ({
  comment: COMMENT,
  email: '',
  enable: 1,
  expire: 0,
  firstname: '',
  groups,
  lastname: '',
});

/** What a fresh cluster holds after the default script: the baseline, and nothing else. */
const BOOTSTRAPPED: CliState = {
  acl: [
    { path: '/', propagate: 1, roleid: 'HfProvisioner', type: 'user', ugid: 'hf-provision@pve' },
    { path: '/', propagate: 1, roleid: 'PVEAuditor', type: 'user', ugid: 'hf-read@pve' },
  ],
  groups: { 'hf-mint': { comment: COMMENT } },
  roles: { ...freshCluster().roles, HfProvisioner: [...PROVISION_PRIVILEGES] },
  users: { 'hf-provision@pve': lane(['hf-mint']), 'hf-read@pve': lane(['hf-mint']) },
};

describe('the script as text', () => {
  const script = provisionBootstrap();

  test('never makes a token or sets a password: its only writes are add/modify of the four', () => {
    const calls = new Set(script.match(/pveum \w+ \w+/g));
    expect([...calls].sort()).toEqual([
      'pveum acl modify',
      'pveum group add',
      'pveum group modify',
      'pveum role add',
      'pveum role modify',
      'pveum user add',
      'pveum user modify',
    ]);
    expect(script).not.toMatch(/--password|passwd|user token/);
    expect(script).toStartWith('#!/bin/sh\n');
    expect(script).toContain('\nset -eu\n');
  });

  test('carries the one privilege list, sorted, as the role it adds', () => {
    expect(script).toContain(`want='${PROVISION_PRIVILEGES.join(',')}'`);
    expect(script).toContain('pveum role add HfProvisioner --privs "$want"');
  });
});

describe('run against a cluster', () => {
  test('a fresh cluster gets exactly the baseline, role and group before what needs them', async () => {
    const run = await runScript(provisionBootstrap(), freshCluster());
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.writes.map((w) => w.split(' --')[0])).toEqual([
      'pveum role add HfProvisioner',
      'pveum group add hf-mint',
      'pveum user add hf-provision@pve',
      'pveum user add hf-read@pve',
      'pveum acl modify /',
      'pveum acl modify /',
    ]);
    expect(run.state).toEqual(BOOTSTRAPPED);
  });

  test('a second run, or a node joining a cluster that has it, writes nothing', async () => {
    const run = await runScript(provisionBootstrap(), structuredClone(BOOTSTRAPPED));
    expect(run.code).toBe(0);
    expect(run.writes).toEqual([]);
    expect(run.stdout.split('\n').filter((line) => line.endsWith(': ok'))).toHaveLength(6);
  });

  test('drift converges with only the writes it needs', async () => {
    const drifted = structuredClone(BOOTSTRAPPED);
    drifted.roles['HfProvisioner'] = [...PROVISION_PRIVILEGES.slice(1), 'VM.Console'];
    drifted.groups['admins'] = { comment: '' };
    drifted.users['hf-read@pve'] = { ...lane(['admins', 'hf-mint']), email: 'x@example.com' };
    drifted.acl = drifted.acl.slice(0, 1);
    const run = await runScript(provisionBootstrap(), drifted);
    expect(run.code).toBe(0);
    expect(run.writes.map((w) => w.split(' --')[0])).toEqual([
      'pveum role modify HfProvisioner',
      'pveum user modify hf-read@pve',
      'pveum acl modify /',
    ]);
    expect(run.state).toEqual({ ...BOOTSTRAPPED, groups: drifted.groups });
  });

  test('a read role that does not exist stops the script before any write', async () => {
    const run = await runScript(provisionBootstrap({ readRole: 'Auditor' }), freshCluster());
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('role Auditor does not exist');
    expect(run.writes).toEqual([]);
  });

  test('no read lane: one user, one grant, no read role needed', async () => {
    const run = await runScript(provisionBootstrap({ readUser: null }), {
      ...freshCluster(),
      roles: {},
    });
    expect(run.code).toBe(0);
    expect(Object.keys(run.state.users)).toEqual(['hf-provision@pve']);
    expect(run.state.acl.map((g) => g.ugid)).toEqual(['hf-provision@pve']);
  });

  test('an EXISTING cluster: only the new object is written, comments and all', async () => {
    // \u2605 THE CASE ONE SHARED COMMENT COULD NOT DESCRIBE. The cluster already has the mint group
    //   (no comment at all) and the read user (its own wording), both of them declared elsewhere
    //   at those live values. Only the provision user is new. With per-object comments the script
    //   writes exactly that user and its grant -- it does not touch the two that already match,
    //   so nothing is left for another stack's next deploy to write back.
    const existing: CliState = {
      acl: [{ path: '/', propagate: 1, roleid: 'PVEAuditor', type: 'user', ugid: 'hf-read@pve' }],
      // \u26a0\ufe0f '' IS "no comment live": the fake's view drops an empty one, as PVE does.
      groups: { 'hf-mint': { comment: '' } },
      roles: { ...freshCluster().roles, Provisioner: ['VM.Audit'] },
      users: { 'hf-read@pve': { ...lane(['hf-mint']), comment: 'mint target: read (ops)' } },
    };
    const run = await runScript(
      provisionBootstrap({
        groupComment: '',
        provisionComment: 'mint target: provision (ops)',
        readComment: 'mint target: read (ops)',
        role: 'Provisioner',
      }),
      existing,
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('group hf-mint: ok');
    expect(run.stdout).toContain('user hf-read@pve: ok');
    // The only writes: the role widened to the baseline, the new user, and its grant.
    expect(run.writes.map((w) => w.split(' ').slice(0, 3).join(' '))).toEqual([
      'pveum role modify',
      'pveum user add',
      'pveum acl modify',
    ]);
    expect(run.state.groups['hf-mint']).toEqual({ comment: '' });
    expect(run.state.users['hf-read@pve']?.comment).toBe('mint target: read (ops)');
    expect(run.state.users['hf-provision@pve']?.comment).toBe('mint target: provision (ops)');
    expect(run.state.roles['Provisioner']).toEqual([...PROVISION_PRIVILEGES]);

    // \u26d4 NEGATIVE CONTROL, so this test can fail: the SAME cluster with one shared comment
    //   rewrites both objects that already matched. That is the write per-object comments exist
    //   to avoid, and it is what another stack's next deploy would put back.
    const shared = await runScript(
      provisionBootstrap({ comment: 'mint target: provision (ops)', role: 'Provisioner' }),
      existing,
    );
    expect(shared.code).toBe(0);
    expect(shared.writes.map((w) => w.split(' ').slice(0, 3).join(' '))).toContain(
      'pveum group modify',
    );
    expect(shared.state.groups['hf-mint']).toEqual({ comment: 'mint target: provision (ops)' });
    expect(shared.state.users['hf-read@pve']?.comment).toBe('mint target: provision (ops)');
  });

  test("a site's own names flow through every step", async () => {
    const names = {
      mintGroup: 'mint',
      provisionUser: 'provisioner@pve',
      readUser: 'auditor@pve',
      role: 'Provisioner',
    };
    const run = await runScript(provisionBootstrap(names), freshCluster());
    expect(run.code).toBe(0);
    expect(Object.keys(run.state.roles).sort()).toEqual(['PVEAuditor', 'Provisioner']);
    expect(run.state.users['provisioner@pve']?.groups).toEqual(['mint']);
    expect(run.state.acl.map((g) => `${g.ugid} ${g.roleid}`)).toEqual([
      'provisioner@pve Provisioner',
      'auditor@pve PVEAuditor',
    ]);
  });
});
