/**
 * K-A4 finding 5 / decision 65 (2026-09-26): the design was amended to let the observe step read
 * `auth get`'s unfiltered stdout on every reconcile, not only on create, with no node-side shell
 * filter — accepted because the key is dropped in memory before anything is logged, returned,
 * stored or put in an error. Split from ceph-auth-reconcile.test.ts (which already covers the
 * happy-path create/no-op/drift secrecy checks) to keep that file under the house line cap; this
 * file is the failure-path proof the decision's own text calls for.
 *
 * ⛔ THE MALFORMED STDOUT MUST ACTUALLY FAIL `JSON.parse`. LAND red team (2026-09-26), CONFIRMED:
 *   an earlier version of this file fed a WELL-FORMED JSON entry that was merely missing `caps` —
 *   a different, never-vulnerable error path (`parseCaps` never even looks at `key`) — so it never
 *   exercised the line that used to interpolate the parse failure's own message. The two shapes
 *   below (ceph-key-leak-assert.ts) are ones that genuinely throw inside `JSON.parse`.
 */
import { describe, expect, test } from 'bun:test';
import { type Seen, run, withFake } from '../openbao/fake-bao.ts';
import {
  KEY_SHAPED_SENTINEL,
  leaksSliceOf,
  trailingCommaKeyStdout,
  unquotedKeyStdout,
} from './ceph-key-leak-assert.ts';
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
const PROPS: CephAuthEntityProps = { caps: CAPS, entity: ENTITY, mount: 'talos-c1', nodes: [MON] };
const okReply = () => ({ status: 200 });

const reconcileOn = async (stdout: string) => {
  const lines: string[] = [];
  const fake = fakeCephDial({ [MON]: [fakeCephOk(stdout)] });
  let caught: unknown;
  let seen: readonly Seen[] = [];
  await withFake(okReply, async (bao) => {
    try {
      await run(
        { BAO_ADDR: bao.address },
        reconcileCephAuthEntity(PROPS, undefined, { dial: fake.dial, log: (l) => lines.push(l) }),
      );
    } catch (cause) {
      caught = cause;
    }
    seen = bao.seen;
  });
  return { caught, lines, writes: seen.filter((s) => s.method !== 'GET') };
};

describe('a malformed present observation', () => {
  test('a well-formed entry missing `caps` never leaks the key it carried (parseCaps never sees it)', async () => {
    const { caught, lines, writes } = await reconcileOn(
      JSON.stringify([{ entity: ENTITY, key: KEY_SHAPED_SENTINEL }]),
    );
    expect(caught).toBeInstanceOf(Error);
    expect(leaksSliceOf(String(caught))).toBe(false);
    expect(writes).toHaveLength(0);
    expect(leaksSliceOf(lines.join('\n'))).toBe(false);
  });

  for (const [shape, stdout] of [
    ['a bare (unquoted) key token', unquotedKeyStdout(ENTITY)],
    ['a trailing comma after the entry', trailingCommaKeyStdout(ENTITY)],
  ] as const) {
    test(`unparseable stdout via ${shape} never leaks a slice of the key, through the full reconcile loop`, async () => {
      // Decision 65 accepts reading `auth get`'s unfiltered stdout on every reconcile only
      // because the key never survives past the parse — including when the parse ITSELF fails on
      // input that (unlike a well-formed-but-incomplete entry) actually contains the key's bytes.
      const { caught, lines, writes } = await reconcileOn(stdout);
      expect(caught).toBeInstanceOf(Error);
      expect(leaksSliceOf(String(caught))).toBe(false);
      expect(writes).toHaveLength(0);
      expect(leaksSliceOf(lines.join('\n'))).toBe(false);
    });
  }
});
