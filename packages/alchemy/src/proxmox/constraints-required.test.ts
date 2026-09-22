/**
 * What the create check will actually DEMAND, committed — plus the families PR 102 wired without
 * a create-form proof of their own.
 *
 * ⛔ THE OBJECTION THIS ANSWERS. Since 2026-09-22 the create form's required parameters are
 *   demanded only when a create is really about to happen (resource-guard.ts), which is correct —
 *   refusing a plan over a request that will never be made is a false positive by construction —
 *   but it moves some coverage out of the runtime and into here. So the required set is written
 *   down: a schema refresh that adds a required parameter to an endpoint this package writes to
 *   is EXACTLY the change that would start refusing creates, and it fails here, with a diff a
 *   reviewer can read, instead of on the first deploy that creates one.
 *
 * ⚠️ THE LIST IS THE VENDOR'S, NOT OURS. Nothing here asserts that a rule is sensible, only that
 *   it is what the two products publish today (pve-manager 9.2.11, proxmox-backup-server 4.2.6-1).
 */
import { describe, expect, test } from 'bun:test';
import { constraintsFor, formViolations } from './constraint-guard.ts';
import type { PveTarget } from './credentials.ts';
import { body as aliasBody } from './firewall-alias-form.ts';
import { PROXMOX_CONSTRAINTS } from './generated/constraints/index.ts';
import { body as haRuleBody } from './ha-rule-form.ts';
import { matcherCreateForm } from './notification-matcher-form.ts';
import { poolCreateForm } from './pool.ts';
import { createBody as replicationCreateBody } from './replication-job-form.ts';

const TARGET: PveTarget = { members: ['pve.test:8006'], mount: 'pve-test', scheme: 'pve' };

const onCreate = (key: string, form: Record<string, string | readonly string[]>) =>
  formViolations(key, form, true);

const requiredOf = (key: string) =>
  Object.entries(constraintsFor(key))
    .filter(([, rule]) => rule.required === true)
    .map(([name]) => name)
    .sort();

describe('every create this package makes, and what the vendor requires of it', () => {
  /**
   * ⚠️ AN ENDPOINT WITH NO REQUIRED PARAMETER IS NOT A MISTAKE. `POST /cluster/backup` and
   *   `POST /cluster/ha/rules` genuinely mark nothing required; recording the empty set is the
   *   same information as recording a full one.
   */
  test('the required set of every tabled POST is exactly this', () => {
    const creates = Object.keys(PROXMOX_CONSTRAINTS)
      .filter((key) => key.includes(':POST '))
      .sort();
    const census = Object.fromEntries(
      creates.map((key) => [key, requiredOf(key)] as const).filter(([, names]) => names.length > 0),
    );
    expect(census).toEqual({
      'pbs:POST /config/datastore': ['name', 'path'],
      'pbs:POST /config/notifications/endpoints/sendmail': ['name'],
      'pbs:POST /config/notifications/endpoints/smtp': ['from-address', 'name', 'server'],
      'pbs:POST /config/notifications/endpoints/webhook': ['method', 'name', 'url'],
      'pbs:POST /config/notifications/matchers': ['name'],
      'pbs:POST /config/prune': ['id', 'schedule', 'store'],
      'pbs:POST /config/sync': ['id', 'remote-store', 'store'],
      'pbs:POST /config/verify': ['id', 'store'],
      'pve:POST /access/groups': ['groupid'],
      'pve:POST /access/roles': ['roleid'],
      'pve:POST /access/users': ['userid'],
      'pve:POST /cluster/firewall/aliases': ['cidr', 'name'],
      'pve:POST /cluster/ha/resources': ['sid'],
      'pve:POST /cluster/metrics/server/{id}': ['port', 'server', 'type'],
      'pve:POST /cluster/notifications/endpoints/gotify': ['name', 'server', 'token'],
      'pve:POST /cluster/notifications/endpoints/sendmail': ['name'],
      'pve:POST /cluster/notifications/endpoints/smtp': ['from-address', 'name', 'server'],
      'pve:POST /cluster/notifications/endpoints/webhook': ['method', 'name', 'url'],
      'pve:POST /cluster/notifications/matchers': ['name'],
      'pve:POST /cluster/replication': ['id', 'target', 'type'],
      'pve:POST /cluster/sdn/vnets': ['vnet', 'zone'],
      'pve:POST /cluster/sdn/vnets/{vnet}/subnets': ['subnet', 'type'],
      'pve:POST /cluster/sdn/zones': ['type', 'zone'],
      'pve:POST /nodes/{node}/ceph/osd': ['dev'],
      'pve:POST /nodes/{node}/ceph/pool': ['name'],
      'pve:POST /nodes/{node}/disks/zfs': ['devices', 'name', 'raidlevel'],
      'pve:POST /nodes/{node}/lxc': ['ostemplate', 'vmid'],
      'pve:POST /nodes/{node}/network': ['iface', 'type'],
      'pve:POST /nodes/{node}/qemu': ['vmid'],
      'pve:POST /pools': ['poolid'],
      'pve:POST /storage': ['storage', 'type'],
    });
  });

  /**
   * ⛔ `PUT /access/acl` IS A CREATE HERE. PVE registers no POST on the ACL collection, so acl.ts
   *   names the same PUT for both — which means its required pair IS demanded on the create path.
   */
  test('the ACL PUT requires a path and a role list, and both are its own props', () => {
    expect(requiredOf('pve:PUT /access/acl')).toEqual(['path', 'roles']);
  });

  /** ⚠️ No POST/PUT this package writes requires a parameter it sends only as a path segment. */
  test('no required parameter is also a path segment of its own endpoint', () => {
    for (const key of Object.keys(PROXMOX_CONSTRAINTS)) {
      const segments = new Set([...key.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]));
      for (const name of requiredOf(key)) expect(segments.has(name), `${key} ${name}`).toBe(false);
    }
  });
});

/**
 * ★ THE FAMILIES PR 102 WIRED, WITH THE PROOF IT DID NOT WRITE. Five of them build their create
 *   form from a builder that is already exported, so covering them costs nothing but this file.
 *   The rest build theirs inline in a spec literal and are covered by the required-set census
 *   above instead — recorded honestly rather than claimed.
 */
describe('the families wired before this sweep pass their own create tables', () => {
  test('Proxmox.Pool', () => {
    expect(
      onCreate(
        'pve:POST /pools',
        poolCreateForm({ comment: 'house', poolid: 'house', target: TARGET }),
      ),
    ).toEqual([]);
  });

  test('Proxmox.FirewallAlias', () => {
    const form = {
      ...aliasBody({ cidr: '192.0.2.0/24', name: 'lab', target: TARGET }),
      name: 'lab',
    };
    expect(onCreate('pve:POST /cluster/firewall/aliases', form)).toEqual([]);
  });

  test('Proxmox.HaRule', () => {
    const form = {
      ...haRuleBody({
        affinity: 'positive',
        nodes: ['n2', 'n3'],
        resources: ['ct:101', 'ct:102'],
        rule: 'keep-together',
        strict: true,
        target: TARGET,
        type: 'node-affinity',
      }),
      rule: 'keep-together',
    };
    expect(onCreate('pve:POST /cluster/ha/rules', form)).toEqual([]);
  });

  test('Proxmox.ReplicationJob', () => {
    expect(
      onCreate(
        'pve:POST /cluster/replication',
        replicationCreateBody({
          guest: 150,
          jobnum: 0,
          schedule: '*/15',
          target: TARGET,
          targetNode: 'n3',
        }),
      ),
    ).toEqual([]);
  });

  /** ⚠️ One builder, two products: both matcher families share `matcherCreateForm`. */
  test('Proxmox.NotificationMatcher and Pbs.NotificationMatcher', () => {
    const form = matcherCreateForm({
      comment: 'route everything to mail-to-root',
      'match-severity': ['warning', 'error'],
      mode: 'all',
      name: 'default-matcher',
      targets: ['mail-to-root'],
    });
    expect(onCreate('pve:POST /cluster/notifications/matchers', form)).toEqual([]);
    expect(onCreate('pbs:POST /config/notifications/matchers', form)).toEqual([]);
  });
});
