/**
 * Release.Binary's `read` with no attributes. Alchemy asks it twice over (ownership/probe.ts): as
 * the ADOPTION PROBE (no row; `olds` is the declaration, `instanceId` fresh) and as the RECOVERY
 * READ of a row whose create never recorded attributes (`olds` and `instanceId` are the row's —
 * Plan.ts for a `creating` row, Apply.ts for such a row it must delete).
 *
 * ⛔ THE PROBE VALIDATES; THE RECOVERY READ NEVER FAILS ITS CALLER. The probe's `olds` is today's
 *   declaration, so a malformed prop fails the plan there, before anything is touched. The recovery
 *   read's `olds` is the FAILED deploy's props, and with `directory: dir.path` — the documented
 *   usage — a first deploy commits its `creating` row while the directory is still an Output, so
 *   the row has no `directory` at all. 🔴 MEASURED 2026-09-22 (adopt-parity.test.ts): after ANY
 *   failed first install — a 404, a checksum mismatch, a mode refused at apply — every later plan
 *   died with `TypeError: undefined is not an object (evaluating 'path.startsWith')`, the fixed
 *   declaration included, and removing the declaration failed too (DestroyError: the orphan's
 *   recovery read crashed the same way). The stage was bricked until a hand `alchemy state delete`.
 *   ownership/probe.ts states the rule this broke: the recovery read "NEVER FAILS THE CALLER".
 * ★ "NOTHING RECOVERED" IS THE SAFE ANSWER, NOT `Unowned`. The plan then re-drives the create, and
 *   reconcile looks at the path itself with every prop resolved: a file there is refused unless
 *   `--adopt` (binary-claim.ts), exactly as ownership.md says a create interrupted while a prop was
 *   an Output resumes. An orphan's row is dropped and its path left alone — a leak at worst, never
 *   a delete of something unproven.
 * ★ THE ROW, NOT THE SHAPE OF `olds`, SAYS WHICH READ THIS IS: a probe's instance id is minted for
 *   the probe, so no row holds it (ownership/rows.ts). Without a Stack or State in context a row
 *   reads as absent, and this validates as the probe does — the behaviour before this file.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import { lift } from '../launchd/host-effect.ts';
import type { HostRunner } from '../launchd/runner.ts';
import { recordedGeneration } from '../ownership/rows.ts';
import type { ReleaseBinaryProps } from './binary-form.ts';
import { readBinary } from './binary-lifecycle.ts';

type Ask = { readonly fqn: string; readonly instanceId: string; readonly olds: unknown };

/** The file a declaration (or a row) names, as `Unowned` — or undefined when there is none. */
export const readWithoutState = (runner: HostRunner, ask: Ask) =>
  Effect.gen(function* () {
    const recovering = (yield* recordedGeneration(ask.fqn, ask.instanceId)) !== undefined;
    const read = lift(() => readBinary(runner, ask.olds as ReleaseBinaryProps));
    const found = recovering
      ? yield* read.pipe(
          Effect.catch((cause) =>
            Effect.as(
              Effect.logWarning(
                `${ask.fqn}: the interrupted create's row cannot locate its binary (${cause.message}); ` +
                  'nothing is recovered, and the create is re-driven with the declaration as it is now',
              ),
              undefined,
            ),
          ),
        )
      : yield* read;
    return found === undefined ? undefined : Unowned(found);
  });
