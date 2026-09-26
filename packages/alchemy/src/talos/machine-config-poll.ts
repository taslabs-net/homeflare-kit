/**
 * Post-apply convergence for `Talos.MachineConfig` — split out of talos-machine-config.ts
 * (2026-09-26, K-A3) once the bounded-poll logic needed its own header. See
 * docs/plans/2026-09-26-talos-stack-first-boot.md, "Converged" and "Bootstrap" sections.
 *
 * ⛔ NO SILENT `converged: false` HERE. A single attempt's own transport failure is swallowed
 *   ONLY inside the bounded loop below — a rebooting node's API is legitimately unreachable for a
 *   while — but the loop AS A WHOLE never swallows: running out of attempts always raises
 *   `TalosConvergenceTimeout`, never a quiet `false`. That distinction is read()'s job, not
 *   reconcile's — see talos-machine-config.ts.
 * ⚠️ SHORT INTERVALS, A LOW CAP, NEVER ONE LONG SLEEP — the house timeout rule, and the specific
 *   reason talosctl's own `health` gate has a 20-minute `--wait-timeout`: a single blocking wait
 *   that long would hide whether THIS process is still alive from anything watching it.
 */
import * as Effect from 'effect/Effect';
import type { ApplyMode } from './resource.ts';
import { TalosConvergenceTimeout } from './talos-errors.ts';

/** Modes whose apply can trigger a full install + reboot. REASONED, Talos v1.13 CLI reference. */
const isRebootish = (mode: ApplyMode) => mode === 'reboot' || mode === 'staged' || mode === 'auto';

/**
 * ★ TWO POLICIES, ONE PER MODE CLASS — REASONED, no live cluster to time this against yet.
 *   `no-reboot`/`try` never drop the API, so a handful of quick retries covers only ordinary
 *   config-propagation lag. `reboot`/`staged`/`auto` can drop the API for a full boot cycle, so
 *   the cap is longer and the interval coarser. Both stay well inside the house rule above.
 */
export type PollPolicy = { readonly intervalMs: number; readonly maxAttempts: number };

const POLICY: { readonly immediate: PollPolicy; readonly rebootish: PollPolicy } = {
  immediate: { intervalMs: 2_000, maxAttempts: 5 }, // ~10s cap
  rebootish: { intervalMs: 5_000, maxAttempts: 24 }, // ~2m cap
};

/**
 * Run `check` until it reports `true` or `maxAttempts` is spent, sleeping `intervalMs` between
 * attempts. A per-attempt failure counts as "not yet" and does not end the loop early.
 */
const pollUntilMatch = <E, R>(
  check: Effect.Effect<boolean, E, R>,
  policy: { readonly intervalMs: number; readonly maxAttempts: number },
): Effect.Effect<boolean, never, R> =>
  Effect.gen(function* () {
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      const matched = yield* check.pipe(Effect.orElseSucceed(() => false));
      if (matched) return true;
      if (attempt < policy.maxAttempts) yield* Effect.sleep(policy.intervalMs);
    }
    return false;
  });

/**
 * Confirm convergence per `mode`'s policy, or fail with `TalosConvergenceTimeout`.
 *
 * Returns which CLAIM was proven, never a boolean — `'read-back'` for the immediate policy
 * (no-reboot/try), `'accepted'` for the reboot-tolerant one (reboot/staged/auto): state records
 * which kind of confirmation actually happened, per the design doc's `converged` field.
 *
 * ⚠️ `policies` IS A TEST SEAM, NOT A PROP. `talos-machine-config.ts` never passes it, so
 *   production always runs the REASONED defaults above; tests pass tiny intervals so a bounded
 *   poll test finishes in milliseconds instead of the real ~10s/~2m caps.
 */
export const confirmConverged = <E, R>(
  node: string,
  mode: ApplyMode,
  check: Effect.Effect<boolean, E, R>,
  policies: { readonly immediate: PollPolicy; readonly rebootish: PollPolicy } = POLICY,
): Effect.Effect<'read-back' | 'accepted', TalosConvergenceTimeout, R> =>
  Effect.gen(function* () {
    const rebootish = isRebootish(mode);
    const policy = rebootish ? policies.rebootish : policies.immediate;
    const matched = yield* pollUntilMatch(check, policy);
    if (!matched) {
      return yield* Effect.fail(
        new TalosConvergenceTimeout({ attempts: policy.maxAttempts, mode, node }),
      );
    }
    return rebootish ? 'accepted' : 'read-back';
  });
