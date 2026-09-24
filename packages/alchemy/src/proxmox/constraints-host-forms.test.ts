/**
 * The host families' REAL create forms — interfaces and ZFS pools — and PBS's notification
 * targets, which carry the very rule the 2026-09-22 incident was about.
 *
 * ★ SPLIT OUT OF constraints-node-forms.test.ts FOR THE 250-LINE CAP. That file is the Ceph and
 *   guest families; this one is what a host itself is made of, plus the PBS half.
 * ⛔ SAME PROOF, SAME REASON: a table that refuses a declaration the vendor would have ACCEPTED is
 *   worse than the 400 it replaces, so each family's own builder goes through
 *   `formViolations(key, form, true)` and an empty result is required.
 */
import { describe, expect, test } from 'bun:test';
import { constraintsFor, formViolations } from './constraint-guard.ts';
import type { PbsTarget, PveTarget } from './credentials.ts';
import { createBody as ifaceCreateForm } from './node-network-form.ts';
import { resolveGroups, targetForm } from './pbs-notification-target-form.ts';
import { createForm as zfsCreateForm } from './zfs-pool-form.ts';

const TARGET: PveTarget = { members: ['pve.test:8006'], mount: 'pve-test', scheme: 'pve' };
const PBS: PbsTarget = { api: 'https://pbs.test:8007/api2/json', mount: 'pbs-test', scheme: 'pbs' };

const onCreate = (key: string, form: Record<string, string | readonly string[]>) =>
  formViolations(key, form, true);

describe('the host families plan clean against their own creates', () => {
  /**
   * 🔴 THE BUG THIS PROOF FOUND. `createForm` was `body`, which never sent `iface` — and PVE marks
   *   it REQUIRED on the POST while `{node}` is the only path parameter. Every NodeNetwork create
   *   this repository could have made would have 400ed; nothing caught it because C1's three nodes
   *   were all adopted, which takes the PUT path. See the 🔴 on `createBody`.
   */
  test('an interface create carries iface, which PVE requires in the body', () => {
    const form = ifaceCreateForm({
      autostart: true,
      cidr: '192.0.2.10/24',
      iface: 'vmbr1.42',
      node: 'n2',
      target: TARGET,
      type: 'vlan',
      'vlan-raw-device': 'vmbr1',
    });
    expect(form['iface']).toBe('vmbr1.42');
    expect(onCreate('pve:POST /nodes/{node}/network', form)).toEqual([]);
  });

  test('iface and type are the required pair, and iface is 2..20 characters', () => {
    const table = constraintsFor('pve:POST /nodes/{node}/network');
    expect(
      Object.entries(table)
        .filter(([, rule]) => rule.required)
        .map(([name]) => name),
    ).toEqual(['iface', 'type']);
    expect(table['iface']).toMatchObject({ maxLength: 20, minLength: 2 });
  });

  /** ⚠️ The PUT takes `iface` in the path, so the update form is right to leave it out. */
  test('the update form, without iface, passes the PUT table', () => {
    expect(constraintsFor('pve:PUT /nodes/{node}/network/{iface}')['iface']).toBeUndefined();
  });

  test('a ZFS pool create passes, and its three required parameters are all sent', () => {
    const form = zfsCreateForm({
      ashift: 12,
      compression: 'lz4',
      devices: ['/dev/nvme0n1', '/dev/nvme1n1'],
      name: 'rpool-data',
      node: 'n2',
      raidlevel: 'mirror',
      target: TARGET,
    });
    expect(onCreate('pve:POST /nodes/{node}/disks/zfs', form)).toEqual([]);
    for (const name of ['devices', 'name', 'raidlevel']) expect(form[name]).toBeDefined();
  });

  test('an ashift above PVE own maximum of 16 is refused', () => {
    expect(
      onCreate(
        'pve:POST /nodes/{node}/disks/zfs',
        zfsCreateForm({
          ashift: 17,
          devices: ['/dev/nvme0n1'],
          name: 'rpool-data',
          node: 'n2',
          raidlevel: 'single',
          target: TARGET,
        }),
      ),
    ).toEqual(['ashift: at most 16']);
  });
});

/**
 * 🔴 `Pbs.NotificationTarget` CARRIES THE INCIDENT'S OWN PARAMETER. `comment` is `maxLength: 128`
 *   with a no-control-characters pattern on all three PBS creates — the same rule, on the same
 *   product, that failed `POST /config/verify` half a deploy in. This family was missing from the
 *   list the sweep started from; it is wired with the rest.
 */
describe('Pbs.NotificationTarget plans clean, and its comment is the 128 again', () => {
  const declared = {
    comment: 'PBS failure mail',
    mailto: ['someone@example.invalid'],
    name: 'mail-to-root',
    target: PBS,
    type: 'sendmail',
  } as const;
  const carry = { header: true, sealed: true } as const;

  test('a sendmail target has no violations', () => {
    const form = targetForm(declared, resolveGroups(declared, {}), carry, 'create');
    expect(form['name']).toBe('mail-to-root');
    expect(onCreate('pbs:POST /config/notifications/endpoints/sendmail', form)).toEqual([]);
  });

  test('a 129-character comment is refused, exactly as on POST /config/verify', () => {
    const over = { ...declared, comment: 'c'.repeat(129) };
    const form = targetForm(over, resolveGroups(over, {}), carry, 'create');
    expect(onCreate('pbs:POST /config/notifications/endpoints/sendmail', form)).toEqual([
      'comment: at most 128 characters',
    ]);
  });

  test('a webhook target sends the url and method PBS requires', () => {
    const hook = {
      method: 'post',
      name: 'hook-house',
      target: PBS,
      type: 'webhook',
      url: 'https://hooks.example.invalid/pbs',
    } as const;
    const form = targetForm(hook, resolveGroups(hook, {}), carry, 'create');
    expect(onCreate('pbs:POST /config/notifications/endpoints/webhook', form)).toEqual([]);
  });
});
