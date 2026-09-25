/** Real SDK HTTP boundary: credential continuity, dynamic fields, digest and task uncertainty. */
import { expect, test } from 'bun:test';
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as TestClock from 'effect/testing/TestClock';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { FAKE_TARGET, withoutBao } from './fake-pve.ts';
import { createGuest, updateGuest } from './lxc-lifecycle.ts';
import type { LxcProps } from './lxc-props.ts';
import { readLive } from './lxc-read.ts';
import { lxcTask } from './lxc-task.ts';

const props: LxcProps = {
  hostname: 'ct-example',
  node: 'pve1',
  vmid: 900,
  target: FAKE_TARGET,
  ostemplate: 'local:vztmpl/test.tar.zst',
  rootfs: 'local-zfs:8',
  net0: 'name=eth0,bridge=vmbr0,ip=dhcp',
  mp0: 'tank:10,mp=/data',
};
type Seen = { method: string; path: string; auth: string | null; form: URLSearchParams };
const UPID = 'UPID:pve1:00000001:0:0:vzcreate:900:test@pve!lease:';

const transport = (
  poll: () => Response = () => Response.json({ data: { status: 'stopped', exitstatus: 'OK' } }),
  index: unknown = [],
) => {
  const seen: Seen[] = [];
  let mints = 0;
  const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname.includes('/creds/')) {
      mints++;
      return Response.json({
        data: { secret: `fake-${mints}`, token_id: `test@pve!lease-${mints}` },
        lease_duration: 0,
      });
    }
    const body = await request.text();
    if (request.method === 'GET') expect(body).toBe('');
    const path = decodeURIComponent(url.pathname.replace(/^\/api2\/json\//, ''));
    seen.push({
      method: request.method,
      path,
      auth: request.headers.get('Authorization'),
      form: new URLSearchParams(body),
    });
    if (path.endsWith('/status')) return poll();
    if (request.method === 'GET' && path.endsWith('/config'))
      return Response.json(
        { data: null, message: "Configuration file 'nodes/pve1/lxc/900.conf' does not exist\n" },
        { status: 500 },
      );
    if (path === 'cluster/resources') {
      expect(url.searchParams.get('type')).toBe('vm');
      return Response.json({ data: index });
    }
    return Response.json({ data: path.endsWith('/config') ? null : UPID });
  };
  const fake = Object.assign(stub, { preconnect: globalThis.fetch.preconnect }) as typeof fetch;
  return {
    seen,
    mints: () => mints,
    layer: FetchHttpClient.layer.pipe(
      Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, fake)),
    ),
  };
};

test('missing config and permission-filtered guest index use one read credential', async () => {
  const fake = transport();
  const result = await withoutBao(() =>
    Effect.runPromise(readLive(props).pipe(Effect.provide(fake.layer))),
  );
  expect(result).toBeUndefined();
  expect(fake.mints()).toBe(1);
  expect(fake.seen.map((call) => call.path)).toEqual([
    'nodes/pve1/lxc/900/config',
    'cluster/resources',
  ]);
  expect(fake.seen[0]?.auth).toBe(fake.seen[1]?.auth);
});

test('each task starts with a fresh credential and every poll keeps its owner', async () => {
  const fake = transport();
  await withoutBao(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* createGuest(props);
        yield* updateGuest(
          props,
          { put: {}, clear: [], resize: [{ disk: 'rootfs', size: '12G' }], refuse: [], drift: [] },
          'digest-live',
        );
      }).pipe(Effect.provide(fake.layer)),
    ),
  );
  expect(fake.mints()).toBe(2);
  expect(fake.seen.map((call) => call.method)).toEqual(['POST', 'GET', 'PUT', 'GET']);
  expect(fake.seen[0]?.auth).toBe(fake.seen[1]?.auth);
  expect(fake.seen[2]?.auth).toBe(fake.seen[3]?.auth);
  expect(fake.seen[0]?.auth).not.toBe(fake.seen[2]?.auth);
  const form = fake.seen[0]?.form;
  expect(form?.get('net0')).toBe(props.net0);
  expect(form?.get('mp0')).toBe(props.mp0);
  expect(form?.has('net[n]')).toBe(false);
  expect(form?.has('node')).toBe(false);
  expect(fake.seen[2]?.form.get('size')).toBe('12G');
});

test('config updates retain the observed digest and concrete indexed form keys', async () => {
  const fake = transport();
  await withoutBao(() =>
    Effect.runPromise(
      updateGuest(
        props,
        {
          put: { net1: 'name=eth1,bridge=vmbr1,ip=dhcp' },
          clear: ['tags'],
          resize: [],
          refuse: [],
          drift: [],
        },
        'observed-digest',
      ).pipe(Effect.provide(fake.layer)),
    ),
  );
  expect(fake.seen).toHaveLength(1);
  const form = fake.seen[0]?.form;
  expect(form?.get('digest')).toBe('observed-digest');
  expect(form?.get('net1')).toBe('name=eth1,bridge=vmbr1,ip=dhcp');
  expect(form?.get('delete')).toBe('tags');
  expect(form?.has('vmid')).toBe(false);
  expect(form?.has('node')).toBe(false);
});

for (const [name, response] of [
  ['denied', () => Response.json({ data: null, message: 'denied' }, { status: 403 })],
  ['malformed', () => Response.json({ data: null })],
] as const) {
  test(`${name} task polling reports uncertainty with UPID, never repeats POST`, async () => {
    const fake = transport(response);
    const error = await withoutBao(() =>
      Effect.runPromise(createGuest(props).pipe(Effect.flip, Effect.provide(fake.layer))),
    );
    expect(String(error)).toContain(UPID);
    expect(String(error)).toContain('task could not be read');
    expect(fake.seen.map((call) => call.method)).toEqual(['POST', 'GET']);
  });
}

test('a still-running task stops at its bound with no second POST', async () => {
  let polls = 0;
  const fake = transport(() => {
    polls++;
    return Response.json({ data: { status: 'running' } });
  });
  const outcome = await withoutBao(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        // Start the virtual clock only after the SDK transport has completed its first response.
        const observed = fake.layer;
        const worker = yield* lxcTask(
          props,
          nodes.createNodeLxc({
            node: props.node,
            vmid: String(props.vmid),
            ostemplate: props.ostemplate ?? '',
          }),
          'create test CT',
          2,
        ).pipe(Effect.exit, Effect.provide(observed), Effect.forkChild);
        const signal = yield* Effect.gen(function* () {
          while (polls < 1) yield* Effect.yieldNow;
          yield* Deferred.succeed(ready, undefined);
        }).pipe(Effect.forkChild);
        yield* Deferred.await(ready);
        yield* TestClock.adjust('2 seconds');
        yield* Fiber.join(signal);
        return yield* Fiber.join(worker);
      }).pipe(Effect.provide(TestClock.layer())),
    ),
  );
  expect(Exit.isFailure(outcome)).toBe(true);
  expect(polls).toBe(2);
  expect(fake.seen.filter((call) => call.method === 'POST')).toHaveLength(1);
});

test('a transitional status value keeps polling, never aborts like an unreadable poll', async () => {
  // ⚠️ `GetNodeTaskStatusResponseStatus` TYPES `status` AS "running" | "stopped" BUT VALIDATES IT
  //   AT RUNTIME AS A PLAIN STRING — that union is not actually enforced on the wire, so a value
  //   this endpoint's real contract was never proven to exclude must be tolerated the same way
  //   `awaitTask` (network-apply-read.ts) tolerates it, rather than read as "task could not be
  //   read" and abort the deploy. The sibling malformed-answer tests above pin the other half:
  //   a response with no `status` field at all still aborts (2026-09-25 adversarial review).
  let polls = 0;
  const fake = transport(() => {
    polls++;
    return Response.json({
      data: { status: polls === 1 ? 'queued' : 'stopped', exitstatus: 'OK' },
    });
  });
  const outcome = await withoutBao(() =>
    Effect.runPromise(
      lxcTask(
        props,
        nodes.createNodeLxc({
          node: props.node,
          vmid: String(props.vmid),
          ostemplate: props.ostemplate ?? '',
        }),
        'create test CT',
        5,
      ).pipe(Effect.provide(fake.layer)),
    ),
  );
  expect(outcome).toBeUndefined();
  expect(polls).toBe(2);
});

for (const index of [null, [{}], [{ vmid: 'unknown', node: 'pve1', type: 'lxc' }]]) {
  test(`malformed guest index ${JSON.stringify(index)} cannot prove absence`, async () => {
    const fake = transport(undefined, index);
    const error = await withoutBao(() =>
      Effect.runPromise(readLive(props).pipe(Effect.flip, Effect.provide(fake.layer))),
    );
    expect(String(error)).toContain('did not identify its rows');
    expect(fake.seen.every((call) => call.method === 'GET')).toBe(true);
  });
}
