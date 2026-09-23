/**
 * The generated tables, looked up by endpoint, and the refusal that stops a plan.
 *
 * ⛔ AN UNKNOWN KEY IS A DEFECT, NOT A REASON TO SKIP THE CHECK — the generator resolves every key
 *   in its source scan against the vendor document, so a key absent here means the tables were
 *   not regenerated, which the message says. Same posture as `../netbox/constraint-guard.ts`.
 */
import * as Effect from 'effect/Effect';
import {
  type EndpointConstraints,
  type EndpointKey,
  type PaperlessBody,
  refusal,
  violations,
} from './constraints.ts';
import { PAPERLESS_CONSTRAINTS } from './generated/constraints/index.ts';

export { PAPERLESS_CONSTRAINTS };

export const constraintsFor = (key: EndpointKey): EndpointConstraints => {
  const table = PAPERLESS_CONSTRAINTS[key];
  if (table === undefined) {
    throw new Error(
      `no vendor constraint table for '${key}'. It is named in this package but not generated: ` +
        'run `bun codegen/paperless.ts` (see codegen/README.md).',
    );
  }
  return table;
};

export const bodyViolations = (
  key: EndpointKey,
  body: PaperlessBody,
  presence: boolean,
): readonly string[] => violations(constraintsFor(key), body, { presence });

/**
 * ⛔ `Effect.die`, NOT `Effect.fail`. A declaration the vendor would reject is a DEFECT in the
 *   stack file, not a recoverable condition.
 */
export const guardBody = (
  key: EndpointKey | undefined,
  body: PaperlessBody,
  presence: boolean,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (key === undefined) return Effect.void;
    const found = bodyViolations(key, body, presence);
    return found.length === 0 ? Effect.void : Effect.die(new Error(refusal(key, found)));
  });
