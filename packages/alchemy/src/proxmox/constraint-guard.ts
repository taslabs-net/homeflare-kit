/**
 * The generated tables, looked up by endpoint, and the refusal that stops a plan.
 *
 * ★ ONE FILE BETWEEN THE PROVIDERS AND THE GENERATED DATA, so `resource.ts` gains three lines
 *   rather than an import of two generated modules and a merge, and so a family that writes its
 *   own handlers (CephPool, PbsDatastore) reaches the same check by the same name.
 *
 * ⛔ AN UNKNOWN KEY IS A DEFECT, NOT A REASON TO SKIP THE CHECK. Silently passing would put us back
 *   where this started: a declaration nothing checked, and a plan that says so in no way at all.
 *   The generator resolves every key in its source scan against the vendor schema, so a key that
 *   is absent here means the tables were not regenerated — which the message says.
 */
import * as Effect from 'effect/Effect';
import type { PveForm } from './client.ts';
import { type EndpointConstraints, type EndpointKey, refusal, violations } from './constraints.ts';
import { PROXMOX_CONSTRAINTS } from './generated/constraints/index.ts';

export { PROXMOX_CONSTRAINTS };

export const constraintsFor = (key: EndpointKey): EndpointConstraints => {
  const table = PROXMOX_CONSTRAINTS[key];
  if (table === undefined) {
    throw new Error(
      `no vendor constraint table for '${key}'. It is named in this package but not generated: ` +
        'run `bun codegen/constraints.ts` (see codegen/README.md).',
    );
  }
  return table;
};

/** Every vendor rule this form breaks. Pure — a test calls it with a literal form. */
export const formViolations = (
  key: EndpointKey,
  form: PveForm,
  presence: boolean,
): readonly string[] => violations(constraintsFor(key), form, { presence });

/**
 * ⛔ `Effect.die`, NOT `Effect.fail`. A declaration the vendor would reject is a DEFECT in the
 *   stack file, not a recoverable condition: there is no retry and no fallback that makes a
 *   129-character comment legal. The same call that refuses a write-back with no read-back
 *   (resource.ts) dies for the same reason.
 */
export const guardForm = (
  key: EndpointKey | undefined,
  form: PveForm,
  presence: boolean,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (key === undefined) return Effect.void;
    const found = formViolations(key, form, presence);
    return found.length === 0 ? Effect.void : Effect.die(new Error(refusal(key, found)));
  });
