/**
 * The observe -> ensure -> sync loop against fakeCephDial + fakeBao — no ssh, no real vault.
 * Mon-transport doc acceptance tests #2 (the reconcile loop itself) and #3 (secret handling). The
 * failure-path half of #3 — a malformed `auth get` reply that still carries a key — is
 * ceph-auth-reconcile-secrecy.test.ts, split out to keep this file under the house line cap.
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
  test('a preflight write, get-or-create, the real write, one quorum check, key never in the attributes', async () => {
    const lines: string[] = [];
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
        reconcileCephAuthEntity(PROPS, undefined, {
          dial: fake.dial,
          log: (line) => lines.push(line),
        }),
      );
      expect(attrs).toEqual(PRIOR);
      expect(JSON.stringify(attrs)).not.toContain(KEY);

      // ⛔ The preflight (K-A4 finding 2) proves the path is writable BEFORE anything is minted —
      //   see ceph-auth-reconcile.ts's header. Both writes land at the same path; only the second
      //   carries the key.
      const writes = writesOf(bao.seen);
      expect(writes).toHaveLength(2);
      expect(writes[0]?.path).toBe('/v1/talos-c1/data/ceph/client.k8s-rbd');
      expect(writes[0]?.body).not.toContain(KEY);
      expect(writes[1]?.path).toBe('/v1/talos-c1/data/ceph/client.k8s-rbd');
      expect(writes[1]?.body).toContain(KEY);

      expect(argvOf(fake.seen)).toEqual([
        ['auth', 'get'],
        ['auth', 'get-or-create'],
        ['quorum_status', '-f'],
      ]);
      for (const call of fake.seen) expect(JSON.stringify(call.argv)).not.toContain(KEY);
      // Decision 65 (LAND finding 5): the create path's own `auth get` observe also reads the
      // keyring's unfiltered stdout — this proves the runner's log line never carries it either.
      expect(lines.join('\n')).not.toContain(KEY);
    });
  });

  test('a vault write refused before anything is minted leaves the mon untouched', async () => {
    const fake = fakeCephDial({ [MON]: [{ kind: 'result', result: ABSENT }] });
    const refused = () => ({ json: { errors: ['permission denied'] }, status: 403 });
    await withFake(refused, async (bao) => {
      await expect(
        run(
          { BAO_ADDR: bao.address },
          reconcileCephAuthEntity(PROPS, undefined, { dial: fake.dial, log: () => {} }),
        ),
      ).rejects.toThrow();
      // Only `auth get` (the observe) reached the mon — the preflight failed before get-or-create.
      expect(argvOf(fake.seen)).toEqual([['auth', 'get']]);
    });
  });
});

describe('a second reconcile, caps unchanged', () => {
  test('zero bao writes, zero quorum checks — the observe alone decides', async () => {
    // Decision 65 (LAND finding 5): this `auth get` reads the keyring's unfiltered stdout too —
    // prove the key never survives into attrs or the per-call log line, same as the create path.
    const lines: string[] = [];
    const fake = fakeCephDial({ [MON]: [fakeCephOk(keyring())] });
    await withFake(okReply, async (bao) => {
      const attrs = await run(
        { BAO_ADDR: bao.address },
        reconcileCephAuthEntity(PROPS, PRIOR, { dial: fake.dial, log: (line) => lines.push(line) }),
      );
      expect(attrs).toEqual(PRIOR);
      expect(JSON.stringify(attrs)).not.toContain(KEY);
      expect(writesOf(bao.seen)).toHaveLength(0);
      expect(fake.seen).toHaveLength(1);
      expect(lines.join('\n')).not.toContain(KEY);
    });
  });
});

describe('caps drift', () => {
  test('runs exactly auth caps, never get-or-create; the fingerprint is reused, not reminted', async () => {
    // Same decision-65 guarantee: the drifted `auth get` reply carries the key in its stdout too.
    const lines: string[] = [];
    const drifted: CephAuthEntityAttributes = { ...PRIOR, caps: OTHER_CAPS };
    const fake = fakeCephDial({
      [MON]: [fakeCephOk(keyring(OTHER_CAPS)), fakeCephOk(HEALTHY_QUORUM)],
    });
    await withFake(okReply, async (bao) => {
      const attrs = await run(
        { BAO_ADDR: bao.address },
        reconcileCephAuthEntity(PROPS, drifted, {
          dial: fake.dial,
          log: (line) => lines.push(line),
        }),
      );
      expect(attrs.caps).toEqual(CAPS);
      expect(attrs.fingerprint).toBe(PRIOR.fingerprint);
      expect(JSON.stringify(attrs)).not.toContain(KEY);
      expect(writesOf(bao.seen)).toHaveLength(0);
      expect(argvOf(fake.seen)).toEqual([
        ['auth', 'get'],
        ['auth', 'caps'],
        ['quorum_status', '-f'],
      ]);
      expect(lines.join('\n')).not.toContain(KEY);
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

describe('a moved identity (K-A4 finding 1)', () => {
  test('an entity edited in place is refused before any ssh call, never re-capped as a takeover', async () => {
    const moved: CephAuthEntityProps = { ...PROPS, entity: 'client.k8s-other' };
    const fake = fakeCephDial({ [MON]: [fakeCephOk(keyring())] });
    await withFake(okReply, async (bao) => {
      await expect(
        run(
          { BAO_ADDR: bao.address },
          reconcileCephAuthEntity(moved, PRIOR, { dial: fake.dial, log: () => {} }),
        ),
      ).rejects.toThrow(/identity moved/);
      // Refused before the transport is ever touched — no `auth get`, no `auth caps`.
      expect(fake.seen).toHaveLength(0);
      expect(writesOf(bao.seen)).toHaveLength(0);
    });
  });

  test('a mount change alone is the same identity move', async () => {
    const moved: CephAuthEntityProps = { ...PROPS, mount: 'talos-c2' };
    const fake = fakeCephDial({});
    await withFake(okReply, async (bao) => {
      await expect(
        run(
          { BAO_ADDR: bao.address },
          reconcileCephAuthEntity(moved, PRIOR, { dial: fake.dial, log: () => {} }),
        ),
      ).rejects.toThrow(/identity moved/);
      expect(fake.seen).toHaveLength(0);
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
