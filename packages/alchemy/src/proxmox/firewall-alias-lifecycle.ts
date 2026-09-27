/** Named SDK operations; pve-firewall 6.0.5 Aliases.pm supplies exact absence and idempotent delete. */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as cluster from '@distilled.cloud/proxmox/cluster';
import { ProxmoxParseError } from '@distilled.cloud/proxmox/Errors';
import * as Effect from 'effect/Effect';
import type { FirewallAliasAttributes, FirewallAliasProps } from './firewall-alias.ts';
import { firewallAliasSpec as spec } from './firewall-alias-config.ts';
import { cidr, fold } from './firewall-alias-form.ts';
import { runPve } from './distilled-pve.ts';
import { specGuards } from './resource-guard.ts';
import { formToSend } from './update-guard.ts';

const { guardCreate, guardUpdate } = specGuards(spec);

export const readFirewallAlias = (props: FirewallAliasProps) =>
  runPve(props.target, 'read', false, cluster.getClusterFirewallAlias({ name: props.name })).pipe(
    Effect.flatMap((live) => {
      // Vendor's GET schema is bare object; read_alias returns the stored name/cidr entry.
      // ⛔ A malformed successful read is not absence and must never authorize a POST.
      if (
        live === null ||
        typeof live !== 'object' ||
        Array.isArray(live) ||
        !('name' in live) ||
        typeof live.name !== 'string' ||
        fold(live.name) !== fold(props.name) ||
        !('cidr' in live) ||
        typeof live.cidr !== 'string' ||
        cidr(live.cidr) === ''
      ) {
        return Effect.fail(
          new ProxmoxParseError({
            body: undefined,
            cause: 'Firewall alias response does not match the requested vendor identity',
          }),
        );
      }
      return Effect.succeed(spec.attributes({ ...live }, props));
    }),
    Effect.catchTag('FirewallAliasNotFound', () => Effect.succeed(undefined)),
  );

/** Vendor deletion silently removes a missing key. All actual SDK failures still propagate. */
export const deleteFirewallAlias = (props: FirewallAliasProps) =>
  runPve(props.target, 'provision', true, cluster.deleteClusterFirewallAlias({ name: props.name }));

export const firewallAliasHandlers = {
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: FirewallAliasProps }) => readFirewallAlias(olds),
  diff: Effect.fn(function* ({
    news,
    output,
  }: {
    news: Input<FirewallAliasProps>;
    output: FirewallAliasAttributes | undefined;
  }) {
    if (!isResolved(news)) return undefined;
    yield* guardCreate(news, output === undefined);
    yield* guardUpdate(news);
    if (output === undefined) return undefined;
    // A case-only spelling is the same vendor key; a real rename remains create-first replacement.
    if (fold(news.name) !== fold(output.name)) return { action: 'replace' } as const;
    const live = yield* readFirewallAlias(news);
    if (live === undefined) {
      yield* guardCreate(news, true);
      return { action: 'update' } as const;
    }
    return { action: spec.matches(live, news) ? 'noop' : 'update' } as const;
  }),
  reconcile: Effect.fn(function* ({ news }: { news: FirewallAliasProps }) {
    const live = yield* readFirewallAlias(news);
    yield* guardCreate(news, live === undefined);
    yield* guardUpdate(news);
    if (live === undefined) {
      yield* runPve(
        news.target,
        'provision',
        true,
        cluster.createClusterFirewallAlias(spec.createForm(news)),
      );
    } else {
      const form = formToSend(spec.matches, live, news, spec.updateForm(news));
      if (form !== undefined)
        yield* runPve(
          news.target,
          'provision',
          true,
          cluster.putClusterFirewallAlias({ ...form, name: news.name }),
        );
    }
    const after = yield* readFirewallAlias(news);
    if (after === undefined)
      return yield* Effect.fail(
        new Error(`${spec.path(news)}: write returned success but the resource is still absent`),
      );
    return after;
  }),
  delete: ({ olds }: { olds: FirewallAliasProps }) => deleteFirewallAlias(olds),
};
