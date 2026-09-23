/**
 * The node-scoped families' REAL create forms, against the vendor's own tables — and PBS's
 * notification targets, which carry the very rule the 2026-09-22 incident was about.
 *
 * ⛔ SAME PROOF AS constraints-forms.test.ts, AND THE SAME REASON FOR IT: a table that refuses a
 *   declaration the vendor would have ACCEPTED is worse than the 400 it replaces, because the
 *   operator cannot tell it from a genuine violation. Each family's own builder, through
 *   `formViolations(key, form, true)`, empty result required.
 */
import { describe, expect, test } from 'bun:test';
import { createForm as daemonCreateForm } from './ceph-daemon-form.ts';
import { createForm as cephFsCreateForm } from './ceph-fs-wire.ts';
import { createOsdForm } from './ceph-osd-write.ts';
import { createBody as cephPoolCreateForm } from './ceph-pool-form.ts';
import { constraintsFor, formViolations } from './constraint-guard.ts';
import type { PveTarget } from './credentials.ts';
import { TARGET as LXC_TARGET, pasted } from './lxc-harness.ts';
import { createForm as lxcCreateForm } from './lxc-create-form.ts';
import { createForm as vmCreateForm } from './qemu.ts';

const TARGET: PveTarget = { members: ['pve.test:8006'], mount: 'pve-test', scheme: 'pve' };

const onCreate = (key: string, form: Record<string, string | readonly string[]>) =>
  formViolations(key, form, true);

describe('the Ceph families plan clean against their own creates', () => {
  /** ⚠️ Three kinds, three endpoints, three parameter schemas — see `DAEMON_ENDPOINTS`. */
  test('a mon, an mds and a mgr each pass their own table', () => {
    expect(
      onCreate(
        'pve:POST /nodes/{node}/ceph/mon/{monid}',
        daemonCreateForm({ kind: 'mon', 'mon-address': '192.0.2.11', node: 'n2', target: TARGET }),
      ),
    ).toEqual([]);
    expect(
      onCreate(
        'pve:POST /nodes/{node}/ceph/mds/{name}',
        daemonCreateForm({ hotstandby: true, kind: 'mds', node: 'n2', target: TARGET }),
      ),
    ).toEqual([]);
    expect(
      onCreate(
        'pve:POST /nodes/{node}/ceph/mgr/{id}',
        daemonCreateForm({ kind: 'mgr', node: 'n2', target: TARGET }),
      ),
    ).toEqual([]);
  });

  test('a CephFS create passes, and pg_num carries the vendor own 8..32768', () => {
    expect(
      onCreate(
        'pve:POST /nodes/{node}/ceph/fs/{name}',
        cephFsCreateForm({
          'add-storage': true,
          name: 'cephfs-example',
          node: 'n2',
          target: TARGET,
        }),
      ),
    ).toEqual([]);
    expect(constraintsFor('pve:POST /nodes/{node}/ceph/fs/{name}')['pg_num']).toMatchObject({
      maximum: 32_768,
      minimum: 8,
    });
  });

  test('an OSD create passes, and dev is the parameter PVE requires', () => {
    expect(
      onCreate(
        'pve:POST /nodes/{node}/ceph/osd',
        createOsdForm({ node: 'n2', osdid: 4, target: TARGET }, '/dev/nvme1n1'),
      ),
    ).toEqual([]);
    expect(constraintsFor('pve:POST /nodes/{node}/ceph/osd')['dev']?.required).toBe(true);
  });

  /**
   * The estate's own pool set, SHAPED: an RBD pool and a CephFS data/metadata pair, size 3 and
   * min_size 2, names replaced. ⛔ `src` ships in the npm tarball and this repository is public —
   * lxc-harness.ts has the rule. The proof is the keys and the bounds, never the strings.
   */
  test('the live CephPool declarations have no violations', () => {
    for (const name of ['rbd-example', 'cephfs-example_data', 'cephfs-example_metadata']) {
      expect(
        onCreate(
          'pve:POST /nodes/{node}/ceph/pool',
          cephPoolCreateForm({
            crush_rule: 'replicated_rule',
            min_size: 2,
            name,
            node: 'n2',
            pg_autoscale_mode: 'on',
            size: 3,
            target: TARGET,
          }),
        ),
        name,
      ).toEqual([]);
    }
  });

  test('a pool asking for size 8 is refused: PVE own maximum is 7', () => {
    expect(
      onCreate(
        'pve:POST /nodes/{node}/ceph/pool',
        cephPoolCreateForm({ name: 'toobig', node: 'n2', size: 8, target: TARGET }),
      ),
    ).toEqual(['size: at most 7']);
  });
});

describe('the guest families plan clean against their own creates', () => {
  /**
   * ⚠️ THE HARNESS DECLARATION, PLUS THE ONE CREATE-ONLY KEY IT CANNOT CARRY. `pasted()` is the
   *   production-SHAPED config with placeholder values (lxc-harness.ts); `ostemplate` is absent
   *   from it because a live config never reports one, and PVE requires it on create.
   */
  test('a full LXC declaration with its template has no violations', () => {
    const form = lxcCreateForm(
      pasted({ ostemplate: 'local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst' }),
    );
    expect(form['vmid']).toBe('900');
    expect(onCreate('pve:POST /nodes/{node}/lxc', form)).toEqual([]);
  });

  /** ⛔ `ostemplate` AND `vmid` ARE THE TWO PVE MARKS REQUIRED, and `{node}` is the path. */
  test('ostemplate and vmid are the required pair, and node is not in the table', () => {
    const table = constraintsFor('pve:POST /nodes/{node}/lxc');
    expect(
      Object.entries(table)
        .filter(([, rule]) => rule.required)
        .map(([name]) => name),
    ).toEqual(['ostemplate', 'vmid']);
    expect(table['node']).toBeUndefined();
  });

  /** ⚠️ The same harness props, against the SECOND endpoint this family writes. */
  test('a resize form passes its own table', () => {
    expect(
      formViolations(
        'pve:PUT /nodes/{node}/lxc/{vmid}/resize',
        { disk: 'rootfs', size: '+8G' },
        true,
      ),
    ).toEqual([]);
    expect(LXC_TARGET.scheme).toBe('pve');
  });

  /**
   * ⛔ THE ONE VALUE THIS PACKAGE ECHOES BACK TO PVE UNCHANGED, AND IT HAS A BOUND. `updateGuest`
   *   carries the `digest` of the config it was judged against so PVE can refuse a write over an
   *   edit that landed meanwhile — and PVE's own schema caps that parameter at 40 characters,
   *   which is exactly a sha1_hex. A version that started returning a longer digest would refuse
   *   its own echo server-side; the point of the assertion is that 40 is not refused HERE.
   */
  test('a config PUT carrying a 40-character digest is not refused', () => {
    expect(
      formViolations(
        'pve:PUT /nodes/{node}/lxc/{vmid}/config',
        { digest: 'a'.repeat(40), memory: '8192' },
        false,
      ),
    ).toEqual([]);
    expect(constraintsFor('pve:PUT /nodes/{node}/lxc/{vmid}/config')['digest']).toMatchObject({
      maxLength: 40,
    });
  });

  test('a VM create passes, and vmid carries PVE own 100..999999999', () => {
    expect(
      onCreate(
        'pve:POST /nodes/{node}/qemu',
        vmCreateForm({
          cores: 2,
          memory: 2048,
          name: 'vm-example',
          node: 'n2',
          target: TARGET,
          vmid: 150,
        }),
      ),
    ).toEqual([]);
    expect(constraintsFor('pve:POST /nodes/{node}/qemu')['vmid']).toMatchObject({
      maximum: 999_999_999,
      minimum: 100,
    });
  });

  test('a vmid below PVE own minimum is refused rather than sent', () => {
    expect(
      onCreate(
        'pve:POST /nodes/{node}/qemu',
        vmCreateForm({ node: 'n2', target: TARGET, vmid: 99 }),
      ),
    ).toEqual(['vmid: at least 100']);
  });
});
