/**
 * hostAppRoles: one role per host, named `<class>--<host>`, and never a secret_id that does not
 * expire. The hosts and classes here are placeholders, not the estate's.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HOST_ROLE_SEPARATOR,
  type HostRoleClass,
  hostAppRoles,
  hostRoleName,
} from './host-approles.ts';
import { parseDuration } from './mount-form.ts';

const INFRA: HostRoleClass = {
  policies: ['host-cert', 'pve-node', 'host-cert'],
  secretIdTtl: '2160h',
  tokenMaxTtl: '1h',
  tokenTtl: '15m',
};
const SIGNER: HostRoleClass = {
  policies: ['ssh-signer'],
  secretIdTtl: '90d',
  tokenMaxTtl: '30m',
  tokenTtl: '10m',
};
const INPUT = {
  classes: { 'operator-signer': SIGNER, 'pve-node': INFRA },
  hosts: [
    { class: 'pve-node', name: 'node-b' },
    { class: 'pve-node', name: 'node-a' },
    { class: 'operator-signer', name: 'workstation-1' },
  ],
};

describe('hostAppRoles', () => {
  it('makes one role per host, named <class>--<host>, sorted', () => {
    const roles = hostAppRoles(INPUT);
    assert.deepEqual(
      roles.map((role) => role.name),
      ['operator-signer--workstation-1', 'pve-node--node-a', 'pve-node--node-b'],
    );
    assert.equal(hostRoleName('pve-node', 'node-a'), 'pve-node--node-a');
  });

  it('gives every role an expiring secret_id — none has secret_id_ttl 0', () => {
    for (const role of hostAppRoles(INPUT)) {
      const seconds = parseDuration(role.secretIdTtl);
      assert.ok(
        seconds !== undefined && seconds > 0,
        `${role.name} secret_id_ttl ${role.secretIdTtl}`,
      );
      assert.equal(role.bindSecretId, true);
    }
  });

  it("carries the class's policies, de-duplicated, and its TTLs", () => {
    const role = hostAppRoles(INPUT).find((each) => each.name === 'pve-node--node-a');
    assert.deepEqual(role?.tokenPolicies, ['host-cert', 'pve-node']);
    assert.equal(role?.tokenTtl, '15m');
    assert.equal(role?.secretIdNumUses, 0);
  });

  it('splits every name back into exactly one class and host', () => {
    for (const role of hostAppRoles(INPUT)) {
      assert.equal(role.name.split(HOST_ROLE_SEPARATOR).length, 2, role.name);
    }
  });

  it('refuses a secret_id that never expires, or does not parse', () => {
    for (const secretIdTtl of ['0', '0s', 'forever']) {
      assert.throws(
        () =>
          hostAppRoles({
            ...INPUT,
            classes: { ...INPUT.classes, 'pve-node': { ...INFRA, secretIdTtl } },
          }),
        /must be a duration above zero/,
      );
    }
  });

  it('gives a host in two classes one role per class', () => {
    const hosts = [
      { class: 'pve-node', name: 'node-c' },
      { class: 'operator-signer', name: 'node-c' },
    ];
    assert.deepEqual(
      hostAppRoles({ ...INPUT, hosts }).map((role) => role.name),
      ['operator-signer--node-c', 'pve-node--node-c'],
    );
  });

  it('refuses unknown classes, a host twice in one class and names that blur the separator', () => {
    const bad = [
      { class: 'nope', name: 'node-c' },
      { class: 'pve-node', name: 'node-a' },
      { class: 'pve-node', name: 'node-a' },
      { class: 'pve-node', name: 'node--x' },
      { class: 'pve-node', name: 'Node-Y' },
    ];
    assert.throws(
      () => hostAppRoles({ ...INPUT, hosts: bad }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /unknown class `nope`/);
        assert.match(error.message, /`node-a` is listed twice in class `pve-node`/);
        assert.match(error.message, /`node--x` is not lowercase/);
        assert.match(error.message, /`Node-Y` is not lowercase/);
        return true;
      },
    );
  });

  it('refuses a class with no policies, with root, or with ttl above max', () => {
    const classes = {
      empty: { ...INFRA, policies: [] },
      rooted: { ...INFRA, policies: ['root'] },
      upside: { ...INFRA, tokenMaxTtl: '5m', tokenTtl: '1h' },
    };
    assert.throws(
      () => hostAppRoles({ classes, hosts: [] }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /`empty` has no policies/);
        assert.match(error.message, /`rooted` grants `root`/);
        assert.match(error.message, /`upside` tokenTtl is longer/);
        return true;
      },
    );
  });
});
