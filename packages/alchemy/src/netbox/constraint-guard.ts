/**
 * The generated tables, looked up by endpoint, and the refusal that stops a plan.
 *
 * ★ ONE FILE BETWEEN THE PROVIDERS AND THE GENERATED DATA, so `resource.ts` gains three lines
 *   rather than an import of the generated module and a merge, and so a family that writes its
 *   own handlers reaches the same check by the same name.
 *
 * ⛔ AN UNKNOWN KEY IS A DEFECT, NOT A REASON TO SKIP THE CHECK. Silently passing would put us
 *   back where this started: a declaration nothing checked, and a plan that says so in no way at
 *   all. The generator resolves every key in its source scan against the vendor document, so a
 *   key that is absent here means the tables were not regenerated — which the message says.
 */
import * as Effect from 'effect/Effect';
import {
  type EndpointConstraints,
  type EndpointKey,
  type NetboxBody,
  refusal,
  violations,
} from './constraints.ts';
import { NETBOX_CONSTRAINTS } from './generated/constraints/index.ts';

export { NETBOX_CONSTRAINTS };

export const constraintsFor = (key: EndpointKey): EndpointConstraints => {
  const table = NETBOX_CONSTRAINTS[key];
  if (table === undefined) {
    throw new Error(
      `no vendor constraint table for '${key}'. It is named in this package but not generated: ` +
        'run `bun codegen/netbox.ts` (see codegen/README.md).',
    );
  }
  return table;
};

/** Every vendor rule this body breaks. Pure — a test calls it with a literal body. */
export const bodyViolations = (
  key: EndpointKey,
  body: NetboxBody,
  presence: boolean,
): readonly string[] => violations(constraintsFor(key), body, { presence });

/**
 * ⛔ `Effect.die`, NOT `Effect.fail`. A declaration the vendor would reject is a DEFECT in the
 *   stack file, not a recoverable condition: there is no retry and no fallback that makes a
 *   201-character description legal.
 */
export const guardBody = (
  key: EndpointKey | undefined,
  body: NetboxBody,
  presence: boolean,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (key === undefined) return Effect.void;
    const found = bodyViolations(key, body, presence);
    return found.length === 0 ? Effect.void : Effect.die(new Error(refusal(key, found)));
  });
