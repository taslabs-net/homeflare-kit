/**
 * Bounded-poll-per-mode acceptance tests from docs/plans/2026-09-26-talos-stack-first-boot.md's
 * "Converged" section — exercised through `reconcileMachineConfig` with `FAST_POLL` (a test-only
 * seam, see machine-config-poll.ts's own header) so the ~10s/~2m production caps never run here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONFIG_TEXT,
  FAST_POLL,
  dispatcher,
  hasTag,
  props,
  run,
  wrapperFor,
} from './machine-config-fixtures.ts';
import type { ApplyMode } from './resource.ts';
import { reconcileMachineConfig } from './talos-machine-config.ts';

describe('reconcileMachineConfig — bounded poll per mode', () => {
  const rebootish: ApplyMode = 'reboot';
  const immediate: ApplyMode = 'no-reboot';

  it("no-reboot converges via a single successful read-back ('read-back')", async () => {
    const out = await run(
      reconcileMachineConfig(props({ mode: immediate }), undefined, FAST_POLL),
      dispatcher({}),
    );
    assert.equal(out.converged, 'read-back');
  });

  it("reboot/auto tolerate a transient miss then converge ('accepted')", async () => {
    let attempt = 0;
    const out = await run(
      reconcileMachineConfig(props({ mode: rebootish }), undefined, FAST_POLL),
      dispatcher({
        liveWrapper: () => {
          attempt += 1;
          return attempt < 2
            ? { exitCode: 1, stderr: 'node rebooting' }
            : { stdout: wrapperFor(CONFIG_TEXT) };
        },
      }),
    );
    assert.equal(out.converged, 'accepted');
  });

  it('raises TalosConvergenceTimeout, never a silent pass, when the cap expires', async () => {
    await assert.rejects(
      run(
        reconcileMachineConfig(props({ mode: rebootish }), undefined, FAST_POLL),
        dispatcher({ liveWrapper: () => ({ exitCode: 1, stderr: 'still unreachable' }) }),
      ),
      hasTag('TalosConvergenceTimeout'),
    );
  });
});
