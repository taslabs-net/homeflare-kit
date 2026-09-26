/**
 * The observe -> ensure -> sync loop against fakeCephDial + fakeBao — no ssh, no real vault.
 * Mon-transport doc acceptance tests #2 (the reconcile loop itself) and #3 (secret handling).
 */
import { describe, expect, test } from 'bun:test';
import { sha256 } from '../openbao/digest.ts';
import { type Reply, type Seen, run, withFake } from '../openbao/fake-bao.ts';
import { reconcileCephAuthEntity } from './ceph-auth-reconcile.ts';
import type { CephAuthEntityAttributes, CephAuthEntityProps } from './ceph-auth-form.ts';
import { fakeCephDial, fakeCephOk } from './fake-ceph-dial.ts';

const ENTITY = 'client.k8s-rbd';
const MON = 'mon-a.example.test';
const CAPS = {
  mgr: 'profile rbd pool=k8s-rbd',
  mon: 'profile rbd',
  osd: 'profile rbd pool=k8s-rbd',
};
const OTHER_CAPS = { ...CAPS, osd: 'profile rbd pool=other' };
const KEY = 'fake-ceph-key-not-a-real-secret';
const keyring = (caps = CAPS) => JSON.stringify([{ caps, entity: ENTITY, key: KEY }]);
const ABSENT = { exitCode: 2, stderr: 'Error ENOENT: not found', stdout: '' };
const HEALTHY_QUORUM = '{"quorum":[0,1,2]}';

const PROPS: CephAuthEntityProps = { caps: CAPS, entity: ENTITY, mount: 'talos-c1', nodes: [MON] };
const PRIOR: CephAuthEntityAttributes = {
  baoPath: 'talos-c1/ceph/client.k8s-rbd',
  caps: CAPS,
  entity: ENTITY,
  fingerprint: sha256(KEY),
  node: MON,
};

const okReply = (): Reply => ({ status: 200 });
const writesOf = (seen: readonly Seen[]) => seen.filter((s) => s.method !== 'GET');
const argvOf = (seen: readonly { readonly argv: readonly string[] }[]) =>
  seen.map((c) => c.argv.slice(1, 3));

describe('create of absent', () => {
  test('get-or-create once, one bao write, one quorum check, and the attributes never carry the key', async () => {
    const fake = fakeCephDial({
      [MON]: [
        { kind: 'result', result: ABSENT },
        fakeCephOk(keyring()),
        fakeCephOk(HEALTHY_QUORUM),
      ],
    });
    await withFake(okReply, async (bao) => {
      const attrs = await run(
        { BAO_ADDR: bao.address },
        reconcileCephAuthEntity(PROPS, undefined, { dial: fake.dial, log: () => {} }),
      );
      expect(attrs).toEqual(PRIOR);
      expect(JSON.stringify(attrs)).not.toContain(KEY);

      const writes = writesOf(bao.seen);
      expect(writes).toHaveLength(1);
      expect(writes[0]?.path).toBe('/v1/talos-c1/data/ceph/client.k8s-rbd');
      expect(writes[0]?.body).toContain(KEY);

      expect(argvOf(fake.seen)).toEqual([
        ['auth', 'get'],
        ['auth', 'get-or-create'],
        ['quorum_status', '-f'],
      ]);
      for (const call of fake.seen) expect(JSON.stringify(call.argv)).not.toContain(KEY);
    });
  });
});

describe('a second reconcile, caps unchanged', () => {
  test('zero bao writes, zero quorum checks — the observe alone decides', async () => {
    const fake = fakeCephDial({ [MON]: [fakeCephOk(keyring())] });
    await withFake(okReply, async (bao) => {
      const attrs = await run(
        { BAO_ADDR: bao.address },
        reconcileCephAuthEntity(PROPS, PRIOR, { dial: fake.dial, log: () => {} }),
      );
      expect(attrs).toEqual(PRIOR);
      expect(writesOf(bao.seen)).toHaveLength(0);
      expect(fake.seen).toHaveLength(1);
    });
  });
});

describe('caps drift', () => {
  test('runs exactly auth caps, never get-or-create; the fingerprint is reused, not reminted', async () => {
    const drifted: CephAuthEntityAttributes = { ...PRIOR, caps: OTHER_CAPS };
    const fake = fakeCephDial({
      [MON]: [fakeCephOk(keyring(OTHER_CAPS)), fakeCephOk(HEALTHY_QUORUM)],
    });
    await withFake(okReply, async (bao) => {
      const attrs = await run(
        { BAO_ADDR: bao.address },
        reconcileCephAuthEntity(PROPS, drifted, { dial: fake.dial, log: () => {} }),
      );
      expect(attrs.caps).toEqual(CAPS);
      expect(attrs.fingerprint).toBe(PRIOR.fingerprint);
      expect(writesOf(bao.seen)).toHaveLength(0);
      expect(argvOf(fake.seen)).toEqual([
        ['auth', 'get'],
        ['auth', 'caps'],
        ['quorum_status', '-f'],
      ]);
    });
  });
});

describe('a down anchor', () => {
  test('every mon failing at the transport layer is an error, never "absent", and nothing is created', async () => {
    const fake = fakeCephDial({});
    await withFake(okReply, async (bao) => {
      await expect(
        run(
          { BAO_ADDR: bao.address },
          reconcileCephAuthEntity(PROPS, undefined, { dial: fake.dial, log: () => {} }),
        ),
      ).rejects.toThrow(/never treated as absent/);
      expect(writesOf(bao.seen)).toHaveLength(0);
    });
  });
});

describe('never adopted', () => {
  test('a live entity present with no prior state is refused outright, never taken over', async () => {
    const fake = fakeCephDial({ [MON]: [fakeCephOk(keyring())] });
    await withFake(okReply, async (bao) => {
      await expect(
        run(
          { BAO_ADDR: bao.address },
          reconcileCephAuthEntity(PROPS, undefined, { dial: fake.dial, log: () => {} }),
        ),
      ).rejects.toThrow(/never adopted/);
      expect(writesOf(bao.seen)).toHaveLength(0);
      expect(fake.seen).toHaveLength(1);
    });
  });
});

describe('a degraded quorum after a write fails the row', () => {
  test('the create is reported as failed even though the ceph write itself landed', async () => {
    const fake = fakeCephDial({
      [MON]: [
        { kind: 'result', result: ABSENT },
        fakeCephOk(keyring()),
        fakeCephOk('{"quorum":[]}'),
      ],
    });
    await withFake(okReply, async (bao) => {
      await expect(
        run(
          { BAO_ADDR: bao.address },
          reconcileCephAuthEntity(PROPS, undefined, { dial: fake.dial, log: () => {} }),
        ),
      ).rejects.toThrow(/degraded/);
    });
  });
});
