/**
 * Exercises `@distilled.cloud/proxmox`'s `awaitTask` (the async-task
 * 200-trap — see that package's `src/protocol.ts` header) against a FAKE
 * `HttpClient`, no live PVE node involved.
 *
 * ⚠️ THIS PACKAGE IS CONSUMED VIA THE INTERIM-PACKAGE ALIAS
 *   (`packages/alchemy/package.json`'s `dependencies`:
 *   `"@distilled.cloud/proxmox": "npm:@homeflare/distilled-proxmox@0.2.0"`)
 *   — see `packages/alchemy/docs/distilled-interim.md`. Nothing in
 *   `packages/alchemy/src/proxmox/*` (the existing 98-resource family) is
 *   touched or migrated onto it here; this file is standalone proof the
 *   package works end to end, ahead of migrating any hand-written resource
 *   onto it (a later PR).
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import * as Proxmox from '@distilled.cloud/proxmox';

const credentials = Proxmox.credentials({
  tokenId: 'root@pam!test',
  secret: 'test-secret',
  baseUrl: 'https://pve.test:8006',
});

/** A fake PVE that answers `running` (no `exitstatus`) `pendingPolls` times, then `finalBody`. */
const fakePve = (pendingPolls: number, finalBody: Record<string, unknown>) => {
  let calls = 0;
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        calls++;
        const body =
          calls <= pendingPolls
            ? {
                status: 'running',
                id: 'qmstart',
                node: 'pve1',
                pid: 100,
                pstart: 1,
                starttime: 1,
                type: 'qmstart',
                upid: 'UPID:pve1:...',
                user: 'root@pam',
              }
            : finalBody;
        return HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify({ data: body }), { status: 200 }),
        );
      }),
    ),
  );
};

const runAwaitTask = (pendingPolls: number, finalBody: Record<string, unknown>) =>
  Effect.runPromise(
    Proxmox.awaitTask(
      { node: 'pve1', upid: 'UPID:pve1:00000001:00000001:00000001:qmstart:100:root@pam:' },
      { pollInterval: '5 millis' },
    ).pipe(Effect.provide(Layer.mergeAll(fakePve(pendingPolls, finalBody), credentials))),
  );

const OK_STATUS = {
  status: 'stopped',
  exitstatus: 'OK',
  id: 'qmstart',
  node: 'pve1',
  pid: 100,
  pstart: 1,
  starttime: 1,
  type: 'qmstart',
  upid: 'UPID:pve1:...',
  user: 'root@pam',
};

describe("awaitTask (against a fake PVE, per protocol.ts's async-task trap)", () => {
  test("resolves once exitstatus is exactly OK, after polling through 'running'", async () => {
    const result = await runAwaitTask(2, OK_STATUS);
    expect(result.exitstatus).toBe('OK');
    expect(result.status).toBe('stopped');
  });

  test('resolves immediately when the task is already done on the first poll', async () => {
    const result = await runAwaitTask(0, OK_STATUS);
    expect(result.exitstatus).toBe('OK');
  });

  test('fails with ProxmoxTaskFailed for any exitstatus other than exactly OK', async () => {
    const failed = await Effect.runPromise(
      Proxmox.awaitTask(
        { node: 'pve1', upid: 'UPID:pve1:00000001:00000001:00000001:qmstart:100:root@pam:' },
        { pollInterval: '5 millis' },
      ).pipe(
        Effect.provide(
          Layer.mergeAll(fakePve(0, { ...OK_STATUS, exitstatus: 'job errors' }), credentials),
        ),
        Effect.flip,
      ),
    );
    expect(failed).toBeInstanceOf(Proxmox.ProxmoxTaskFailed);
    expect(failed).toMatchObject({ node: 'pve1', exitstatus: 'job errors' });
  });

  // ⛔ "OK (warnings)" is NOT a success — see task.ts's exact-equality note.
  test("fails (does not swallow) 'OK (warnings)'", async () => {
    const failed = await Effect.runPromise(
      Proxmox.awaitTask(
        { node: 'pve1', upid: 'UPID:pve1:00000001:00000001:00000001:qmstart:100:root@pam:' },
        { pollInterval: '5 millis' },
      ).pipe(
        Effect.provide(
          Layer.mergeAll(fakePve(0, { ...OK_STATUS, exitstatus: 'OK (warnings)' }), credentials),
        ),
        Effect.flip,
      ),
    );
    expect(failed).toBeInstanceOf(Proxmox.ProxmoxTaskFailed);
    expect(failed).toMatchObject({ exitstatus: 'OK (warnings)' });
  });
});
