/**
 * Exercises `@distilled.cloud/proxmox`'s `awaitTask` (the async-task
 * 200-trap — see that package's `src/protocol.ts` header) against a FAKE
 * `HttpClient`, no live PVE node involved.
 *
 * ⚠️ THIS PACKAGE IS CONSUMED VIA A DEV-ONLY `link:` DEPENDENCY
 *   (`packages/alchemy/package.json`'s `devDependencies`), pointing at
 *   `bun link @distilled.cloud/proxmox` registered from the sibling
 *   `distilled` worktree — see distilled-rules.md's KIT RULES. Nothing in
 *   `packages/alchemy/src/proxmox/*` (the existing 98-resource family) is
 *   touched or migrated onto it here; this file is standalone proof the
 *   package works end to end, ahead of the interim-package route (the
 *   NetBox builder's work) that will carry it into a shipped dependency.
 *
 * ⚠️ MEASURED, NOT ASSUMED: this link crosses two SEPARATE git worktrees
 *   with two SEPARATE package managers (the kit's bun install, the
 *   distilled clone's pnpm install), each with its own physical copy of
 *   `effect@4.0.0-rc.115` — same version string, different files on disk
 *   (`node_modules/.bun/effect@4.0.0-rc.115/...` here vs.
 *   `.../worktrees/distilled/proxmox/node_modules/.pnpm/effect@4.0.0-rc.115/...`
 *   there, confirmed with `Bun.resolveSync` from each package's own real
 *   directory). This test is exactly the way to find out whether that
 *   breaks Effect's `Context.Tag` service identity across the two copies
 *   (distilled-rules.md's own "two copies of core/effect break service
 *   tags at runtime" trap) for THIS package's actual surface — see this
 *   session's report for what running it found.
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
