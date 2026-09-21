/**
 * sys/remount and its status loop against a fake. The shapes pinned here are the CLI's own
 * (api/sys_mounts.go:95-191): POST `{from, to}`, then poll until `success` or `failure`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import { type Reply, type Seen, run, withFake } from './fake-bao.ts';
import { RemountError, remountAndWait } from './remount-wire.ts';

const STARTED = { json: { data: { migration_id: 'm-1' }, warnings: ['queued'] }, status: 200 };
const status = (value: string): Reply => ({
  json: {
    data: {
      migration_id: 'm-1',
      migration_info: { source_mount: 'kv/', status: value, target_mount: 'kv-moved/' },
    },
  },
  status: 200,
});
const FORGOTTEN: Reply = { json: { errors: [] }, status: 404 };

/** Answer the start, then each status read from `statuses` in order (the last one repeats). */
const script = (...statuses: Reply[]) => {
  let polls = 0;
  return (seen: Seen): Reply => {
    if (seen.path === '/v1/sys/remount') return STARTED;
    const reply = statuses[Math.min(polls, statuses.length - 1)] ?? FORGOTTEN;
    polls += 1;
    return reply;
  };
};

const FAST = { attempts: 3, intervalMillis: 1 };
const moved = (confirm = Effect.succeed(true)) => remountAndWait('kv', 'kv-moved', confirm, FAST);

describe('remountAndWait', () => {
  it('posts from/to and polls until success', async () => {
    await withFake(script(status('in-progress'), status('success')), async (bao) => {
      await run({ BAO_ADDR: bao.address }, moved());
      assert.deepEqual(
        bao.seen.map((seen) => [seen.method, seen.path, seen.body]),
        [
          ['POST', '/v1/sys/remount', JSON.stringify({ from: 'kv', to: 'kv-moved' })],
          ['GET', '/v1/sys/remount/status/m-1', ''],
          ['GET', '/v1/sys/remount/status/m-1', ''],
        ],
      );
    });
  });

  it('fails a migration OpenBao reports failed, naming the id', async () => {
    await withFake(script(status('failure')), async (bao) => {
      await assert.rejects(run({ BAO_ADDR: bao.address }, moved()), (error: unknown) => {
        assert.ok(error instanceof RemountError);
        assert.match(error.message, /migration m-1\) FAILED/);
        return true;
      });
    });
  });

  it('settles a forgotten migration from the mount tables, both ways', async () => {
    await withFake(script(FORGOTTEN), async (bao) => {
      await run({ BAO_ADDR: bao.address }, moved(Effect.succeed(true)));
    });
    await withFake(script(FORGOTTEN), async (bao) => {
      await assert.rejects(
        run({ BAO_ADDR: bao.address }, moved(Effect.succeed(false))),
        /no longer knows the migration/,
      );
    });
  });

  it('gives up after the bounded number of status reads', async () => {
    await withFake(script(status('in-progress')), async (bao) => {
      await assert.rejects(run({ BAO_ADDR: bao.address }, moved()), /still in progress after 3/);
      assert.equal(bao.seen.length, 4);
    });
  });

  it('fails a start that names no migration id', async () => {
    const answer = () => ({ json: { data: {} }, status: 200 });
    await withFake(answer, async (bao) => {
      await assert.rejects(run({ BAO_ADDR: bao.address }, moved()), /no migration_id/);
    });
  });
});
