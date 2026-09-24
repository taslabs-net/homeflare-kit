/**
 * The CephFS destroy lifecycle through the real SDK protocol and Alchemy engine.
 * The original transport walk left DELETE on the hand client; SDK 0.3.0's query
 * binding now permits the whole sequence to move. These tests keep the destructive
 * read/delete/poll/read-back boundary covered without touching a real filesystem.
 */
import { describe, expect, test } from 'bun:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { ProxmoxCephFs, ProxmoxCephFsProvider } from './ceph-fs.ts';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';

const NODE = 'node-b';
const NAME = 'oldfs';
const INDEX = `nodes/${NODE}/ceph/fs`;
const OBJECT = `${INDEX}/${NAME}`;
const UPID = 'UPID:node-b:fake:destroyfs';
const TASK_STATUS = `nodes/${NODE}/tasks/${encodeURIComponent(UPID)}/status`;

const declared = () => ProxmoxCephFs(NAME, { name: NAME, node: NODE, target: FAKE_TARGET });

describe('destroying a CephFS', () => {
  test(
    'RemovalPolicy.destroy() then undeclaring: readFs (distilled) finds it, destroyFs ' +
      '(distilled) removes it, and the distilled read-back confirms it is gone',
    async () => {
      let destroyed = false;
      const fake = fakePve((call: PveCall) => {
        if (call.method === 'GET' && call.path === INDEX) {
          return destroyed
            ? []
            : [{ data_pool: `${NAME}_data`, metadata_pool: `${NAME}_metadata`, name: NAME }];
        }
        if (call.method === 'DELETE' && call.path === OBJECT) {
          destroyed = true;
          return UPID;
        }
        if (call.method === 'GET' && call.path === TASK_STATUS) {
          return { exitstatus: 'OK', status: 'stopped' };
        }
        return undefined;
      });
      await withoutBao(async () => {
        const engine = engineOver(ProxmoxCephFsProvider().pipe(Layer.provideMerge(fake.layer)));
        expect(await engine.deploy(declared())).toEqual({ [NAME]: 'adopted' });
        await engine.deploy(declared().pipe(RemovalPolicy.destroy()));
        await engine.deploy(Effect.void);
      });
      expect(fake.writes()).toEqual([`DELETE ${OBJECT}`]);
    },
  );

  test('a filesystem already removed by hand: delete is a no-op, not a false DELETE', async () => {
    let removedByHand = false;
    const fake = fakePve((call: PveCall) => {
      if (call.method === 'GET' && call.path === INDEX) {
        return removedByHand
          ? []
          : [{ data_pool: `${NAME}_data`, metadata_pool: `${NAME}_metadata`, name: NAME }];
      }
      return undefined;
    });
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxCephFsProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declared())).toEqual({ [NAME]: 'adopted' });
      await engine.deploy(declared().pipe(RemovalPolicy.destroy()));
      // ⚠️ Cleaned up outside Alchemy, AFTER that redeploy and BEFORE the undeclare below —
      //   `readFs` (distilled) already answers absent by the time `delete` runs, the same branch
      //   ceph-fs.ts's own ⚠️ on `delete` documents. Removing it any earlier would instead read as
      //   drift on the redeploy above and reconcile a create, which is a different test.
      removedByHand = true;
      await engine.deploy(Effect.void);
    });
    expect(fake.writes()).toEqual([]);
  });
});
