/**
 * K-A4 finding 5 / decision 65 (2026-09-26): the design was amended to let the observe step read
 * `auth get`'s unfiltered stdout on every reconcile, not only on create, with no node-side shell
 * filter — accepted because the key is dropped in memory before anything is logged, returned,
 * stored or put in an error. Split from ceph-auth-reconcile.test.ts (which already covers the
 * happy-path create/no-op/drift secrecy checks) to keep that file under the house line cap; this
 * file is the failure-path proof the decision's own text calls for.
 */
import { describe, expect, test } from 'bun:test';
import { run, withFake } from '../openbao/fake-bao.ts';
import { reconcileCephAuthEntity } from './ceph-auth-reconcile.ts';
import type { CephAuthEntityProps } from './ceph-auth-form.ts';
import { fakeCephDial, fakeCephOk } from './fake-ceph-dial.ts';

const ENTITY = 'client.k8s-rbd';
const MON = 'mon-a.example.test';
const CAPS = {
  mgr: 'profile rbd pool=k8s-rbd',
  mon: 'profile rbd',
  osd: 'profile rbd pool=k8s-rbd',
};
const KEY = 'sentinel-ceph-key-must-never-leak';
const PROPS: CephAuthEntityProps = { caps: CAPS, entity: ENTITY, mount: 'talos-c1', nodes: [MON] };
const okReply = () => ({ status: 200 });

describe('a malformed present observation', () => {
  test('a parse failure on an unfiltered `auth get` never leaks the key it carried', async () => {
    // The mon answers with a keyring entry missing `caps` — a parse error — but its stdout still
    // carries a real-shaped key. Decision 65 accepts reading that stdout on every reconcile only
    // because the key never survives past the parse: prove it here on the failure path.
    const lines: string[] = [];
    const malformed = JSON.stringify([{ entity: ENTITY, key: KEY }]);
    const fake = fakeCephDial({ [MON]: [fakeCephOk(malformed)] });
    await withFake(okReply, async (bao) => {
      let caught: unknown;
      try {
        await run(
          { BAO_ADDR: bao.address },
          reconcileCephAuthEntity(PROPS, undefined, {
            dial: fake.dial,
            log: (line) => lines.push(line),
          }),
        );
      } catch (cause) {
        caught = cause;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(String(caught)).not.toContain(KEY);
      expect(bao.seen.filter((s) => s.method !== 'GET')).toHaveLength(0);
      expect(lines.join('\n')).not.toContain(KEY);
    });
  });
});
