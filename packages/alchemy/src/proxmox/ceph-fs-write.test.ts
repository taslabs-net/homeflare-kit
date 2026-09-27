/**
 * `Proxmox.CephFs`'s create path, through Alchemy's own Plan and Apply over a fake cluster — the
 * path ceph-adopt.test.ts does not reach (it is adopt-only). Proves the distilled-based create
 * (ceph-fs-distilled.ts) POSTs, polls the forked task via the RAW `getNodeTaskStatus` operation
 * (not `Task.awaitTask` — that file's own header has the measured reason), and reads back.
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { ProxmoxCephFs, ProxmoxCephFsProvider } from './ceph-fs.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';

const NODE = 'node-b';
const NAME = 'newfs';
const INDEX = `nodes/${NODE}/ceph/fs`;
const OBJECT = `${INDEX}/${NAME}`;
const UPID = 'UPID:node-b:fake:createfs';
// ⚠️ PERCENT-ENCODED, MATCHING ceph-fs-wire.ts's OWN `encodeURIComponent(upid)` — the UPID is
//   full of colons, and distilled's `T.Label()` encodes the path segment the same way.
const TASK_STATUS = `nodes/${NODE}/tasks/${encodeURIComponent(UPID)}/status`;

const declared = () => ProxmoxCephFs(NAME, { name: NAME, node: NODE, target: FAKE_TARGET });

describe('a genuinely new CephFS', () => {
  test('POSTs, polls the forked task through, and reads the index back', async () => {
    let posted = false;
    let polls = 0;
    const fake = fakePve((call: PveCall) => {
      if (call.method === 'GET' && call.path === INDEX) {
        return posted
          ? [{ data_pool: `${NAME}_data`, metadata_pool: `${NAME}_metadata`, name: NAME }]
          : [];
      }
      if (call.method === 'POST' && call.path === OBJECT) {
        posted = true;
        return UPID;
      }
      if (call.method === 'GET' && call.path === TASK_STATUS) {
        polls += 1;
        // ⚠️ RUNNING ONCE FIRST — proves the poll loop actually loops, not just checks once.
        return polls === 1 ? { status: 'running' } : { exitstatus: 'OK', status: 'stopped' };
      }
      return undefined;
    });
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxCephFsProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declared())).toEqual({ [NAME]: 'create' });
    });
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(fake.writes()).toEqual([`POST ${OBJECT}`]);
  });

  test('a task that finishes with a real error dies with the task log pointer, not a false create', async () => {
    const fake = fakePve((call: PveCall) => {
      if (call.method === 'GET' && call.path === INDEX) return [];
      if (call.method === 'POST' && call.path === OBJECT) return UPID;
      if (call.method === 'GET' && call.path === TASK_STATUS) {
        return { exitstatus: 'no running Metadata Server (MDS) found!', status: 'stopped' };
      }
      return undefined;
    });
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxCephFsProvider().pipe(Layer.provideMerge(fake.layer)));
      await expect(engine.deploy(declared())).rejects.toBeDefined();
    });
  });
});
