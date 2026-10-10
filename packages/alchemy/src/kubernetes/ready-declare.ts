/**
 * Declaration-time guards for `HomeFlare.Kubernetes.Ready` (the `withLiteralConnection` shape): a
 * fresh resource with unresolved inputs skips `diff`, so anything that must be refused has to be
 * refused when the resource is DECLARED. Plain props fail the declaring Effect; a props Effect
 * fails once it yields.
 *
 * ⛔ `checks`: a check that can never be satisfied (empty name, a namespaced kind with no
 *   namespace, `minReady` below 1) is a typed `KubernetesReadyBadCheck`, not a 10 minute timeout
 *   (`validateChecks`, round 1 finding 3).
 * ⛔ `after`: only a LAZY Output of the chart (`chart.objects`) orders the row after the chart's
 *   UPDATE. `chart.connection` (a stable) resolves to a plain value at plan time, and a bare
 *   `chart` resolves to its stables, so Ready would plan `noop` before the chart updates and the
 *   gate would be silently skipped (round 1 finding 5). Both are `KubernetesReadyBadAfter`.
 */
import { isExpr, isRefExpr, isResourceExpr } from 'alchemy/Output';
import * as Effect from 'effect/Effect';
import { validateChecks } from './ready-checks.ts';
import { KubernetesReadyBadAfter } from './ready-errors.ts';

/** The typed refusal for the given props, or `undefined`. */
export const declarationRefusal = (props: unknown) => {
  const { after, checks } = (props ?? {}) as { after?: unknown; checks?: unknown };
  const badCheck = validateChecks(checks);
  if (badCheck !== undefined) return badCheck;
  if (after === undefined) return undefined;
  const list = Array.isArray(after) ? after : [after];
  const index = list.findIndex((item) => !isExpr(item) || isResourceExpr(item) || isRefExpr(item));
  return index === -1 ? undefined : new KubernetesReadyBadAfter({ index });
};

export const declaredReady = <C extends (...args: never[]) => unknown>(resource: C): C =>
  new Proxy(resource, {
    apply: (target, thisArg, args: unknown[]) => {
      const props = args[1];
      if (Effect.isEffect(props)) {
        const checked = props.pipe(
          Effect.flatMap((resolved) => {
            const refused = declarationRefusal(resolved);
            return refused === undefined ? Effect.succeed(resolved) : Effect.fail(refused);
          }),
        );
        return Reflect.apply(target, thisArg, [args[0], checked, ...args.slice(2)]);
      }
      const refused = declarationRefusal(props);
      return refused === undefined ? Reflect.apply(target, thisArg, args) : Effect.fail(refused);
    },
  });
