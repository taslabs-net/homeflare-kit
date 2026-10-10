/**
 * Declaration-time guards for `HomeFlare.Kubernetes.Ready` (the `withLiteralConnection` shape): a
 * fresh resource with unresolved inputs skips `diff`, so anything that must be refused has to be
 * refused when the resource is DECLARED. Plain props fail the declaring Effect; a props Effect
 * fails once it yields.
 *
 * ⛔ `checks`: a check that can never be satisfied (empty name, a namespaced kind with no
 *   namespace, `minReady` below 1) is a typed `KubernetesReadyBadCheck`, not a 10 minute timeout
 *   (`validateChecks`, round 1 finding 3).
 * ⛔ `after`: ONLY `chart.objects` (a `PropExpr` whose identifier is `objects`) orders the row after
 *   the chart's UPDATE. Any other property of the chart (`chart.connection`, `chart.releaseName`)
 *   is a stable that Alchemy fills from state while the chart updates, so it resolves to a plain
 *   value at plan time, Ready plans `noop` and the gate is silently skipped; a bare `chart`
 *   resolves to its stables the same way (round 1 finding 5; round 2: a property-expression test,
 *   not a plain-object stand-in, proved `chart.connection` slipped through). Every other shape is
 *   `KubernetesReadyBadAfter`.
 */
import { isPropExpr } from 'alchemy/Output';
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
  const index = list.findIndex((item) => !(isPropExpr(item) && item.identifier === 'objects'));
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
