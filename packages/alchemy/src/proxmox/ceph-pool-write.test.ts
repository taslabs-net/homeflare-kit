/**
 * `Proxmox.CephPool`'s write paths, through Alchemy's own Plan and Apply over a fake cluster —
 * the paths ceph-pool-adopt.test.ts does not reach: a genuine create, the PG-merge guard that
 * stops a create over a pool the read could not confirm, and a real destroy.
 *
 * ★ THE ABSENCE SIGNAL IS THE MEASURED ONE. `GET .../pool/{name}/status` on a name with no pool
 *   answers HTTP 500 (live TB4 `n2`, 2026-09-24, read-role, read-only probe:
 *   `{"data":null,"message":"error with 'osd pool get': mon_cmd failed - unrecognized pool
 *   '<name>'\n"}`) — SDK PR #265 now recognizes it as `CephPoolNotFound`. Only that tag folds
 *   to absence; unrelated 500s propagate. `confirmAbsent` (ceph-pool-settle.ts) still asks a
 *   SECOND, different question — does the index list this name — before create may run.
 *   `fakePve` only answers HTTP 200, so this file stubs the measured 500 directly.
 */
import { describe, expect, test } from 'bun:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { engineOver } from '../verify/fake-engine.ts';
import { ProxmoxCephPool, ProxmoxCephPoolProvider } from './ceph-pool.ts';
import { FAKE_TARGET, withoutBao } from './fake-pve.ts';

const NODE = 'node-b';
const NAME = 'newpool';
const INDEX = `nodes/${NODE}/ceph/pool`;
const OBJECT = `${INDEX}/${NAME}`;
const STATUS = `${OBJECT}/status`;

/** The measured missing-pool 500, classified by the SDK as `CephPoolNotFound`. */
const absent = () =>
  Response.json(
    {
      data: null,
      message: `error with 'osd pool get': mon_cmd failed - unrecognized pool '${NAME}'\n`,
    },
    { status: 500 },
  );

/**
 * A cluster the test drives through three states: no pool at all, the pool listed but its status
 * unreadable (the PG-merge guard's own case), and a real pool. `writes` records every non-GET
 * call the same way `fakePve.writes()` does, for the same assertions.
 */
const cluster = () => {
  const writes: string[] = [];
  let indexRow: Record<string, unknown> | undefined;
  let statusRow: Record<string, unknown> | undefined;
  const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname.includes('/creds/')) {
      const data = { secret: 'fake-secret-not-real', token_id: 'hf-test@pve!fake' };
      return Response.json({ data, lease_duration: 0 });
    }
    const wire = decodeURIComponent(url.pathname.replace(/^\/api2\/json\//, ''));
    if (request.method !== 'GET') writes.push(`${request.method} ${wire}`);
    if (wire === INDEX && request.method === 'GET') {
      return Response.json({ data: indexRow === undefined ? [] : [indexRow] });
    }
    if (wire === INDEX && request.method === 'POST') {
      indexRow = { pool_name: NAME };
      statusRow = {
        application_list: [],
        crush_rule: 'replicated_rule',
        id: 9,
        min_size: 2,
        name: NAME,
        pg_autoscale_mode: 'on',
        pg_num: 128,
        size: 3,
      };
      return Response.json({ data: 'UPID:node-b:fake:createpool' });
    }
    if (wire === STATUS && request.method === 'GET') {
      return statusRow === undefined ? absent() : Response.json({ data: statusRow });
    }
    if (wire === OBJECT && request.method === 'DELETE') {
      indexRow = undefined;
      statusRow = undefined;
      return Response.json({ data: 'UPID:node-b:fake:destroypool' });
    }
    return Response.json({ data: null });
  };
  const fetchStub = Object.assign(stub, { preconnect: globalThis.fetch.preconnect });
  return {
    layer: FetchHttpClient.layer.pipe(
      Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, fetchStub as typeof fetch)),
    ),
    listAsIfPresent: () => {
      indexRow = { pool_name: NAME };
    },
    writes,
  };
};

const declared = () =>
  ProxmoxCephPool(NAME, {
    crush_rule: 'replicated_rule',
    min_size: 2,
    name: NAME,
    node: NODE,
    pg_autoscale_mode: 'on',
    size: 3,
    target: FAKE_TARGET,
  });

const engineFor = (fake: ReturnType<typeof cluster>) =>
  engineOver(ProxmoxCephPoolProvider().pipe(Layer.provideMerge(fake.layer)));

describe('a genuinely new pool', () => {
  test('creates once confirmAbsent finds the index empty, and settle confirms the match', async () => {
    const fake = cluster();
    await withoutBao(async () => {
      const engine = engineFor(fake);
      expect(await engine.deploy(declared())).toEqual({ [NAME]: 'create' });
    });
    expect(fake.writes).toEqual([`POST ${INDEX}`]);
  });
});

describe("the PG-merge guard: the index lists the pool but its status can't be read", () => {
  test('refuses the create rather than risking a PG merge on a live pool', async () => {
    const fake = cluster();
    fake.listAsIfPresent(); // index says present; statusRow stays undefined -> every read 500s
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await expect(engine.deploy(declared())).rejects.toBeDefined();
    });
    // ⛔ THE ASSERTION THAT MATTERS: no POST ever reached the fake cluster.
    expect(fake.writes).toEqual([]);
  });
});

describe('destroying a pool', () => {
  test('RemovalPolicy.destroy() then undeclaring sends exactly one DELETE', async () => {
    const fake = cluster();
    await withoutBao(async () => {
      const engine = engineFor(fake);
      expect(await engine.deploy(declared())).toEqual({ [NAME]: 'create' });
      await engine.deploy(declared().pipe(RemovalPolicy.destroy()));
      await engine.deploy(Effect.void);
    });
    expect(fake.writes).toEqual([`POST ${INDEX}`, `DELETE ${OBJECT}`]);
  });
});
