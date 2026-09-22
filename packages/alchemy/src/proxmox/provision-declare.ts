/**
 * `declareProvisionBaseline` — the provisioning baseline (provision-baseline.ts) as resources, so a
 * stack adopts what the bootstrap made and keeps it: the role, the mint group, one user per lane
 * (its group membership included) and the grant binding each user to its role on `/`.
 *
 *     const lane = yield* declareProvisionBaseline('pve', target);
 *     // names are generic by default; a site passes its own:
 *     const lane = yield* declareProvisionBaseline('pve', target, { role: 'Provisioner' });
 *
 * Provide `ProxmoxRoleProvider()`, `ProxmoxGroupProvider()`, `ProxmoxUserProvider()` and
 * `ProxmoxAclProvider()` with `FetchHttpClient.layer`.
 *
 * ⛔ EVERY RESOURCE HERE RETAINS. This is the branch the whole package sits on (user.ts): dropping
 *   the call from a stack must drop state, never the role, the users or their grants — deleting the
 *   provision user revokes every lease at once, the plan that would recreate it included.
 * ⛔ ADOPTION IS THE OPERATOR'S TO STATE, AS EVERYWHERE IN THE KIT (docs/ownership.md). The first
 *   deploy after the bootstrap finds all of this live with no state: run it with `--adopt`, or pass
 *   `{ adopt: true }`, which pipes `adopt(true)` onto each resource. `{ adopt: false }` pins them
 *   refused under a deploy-wide `--adopt`. Left out, the deploy's own policy decides.
 *   ⚠️ TODAY THE FOUR FAMILIES STILL READ A LIVE OBJECT WITH NO STATE AS OURS (the `pveHandlers`
 *     limit in ownership.md), so the flag is not yet what stops a claim. It is stated here so that
 *     when they follow the rule, a stack built on this helper already says what it means.
 * ★ THE BOOTSTRAP MAKES EXACTLY THIS, so a clean adoption writes nothing: the same privileges, the
 *   same comment, the same single group per user (provision-bootstrap.ts reads the same baseline).
 * ★ PLAIN NAMES, NOT ONE RESOURCE'S OUTPUT IN ANOTHER'S PROPS. An Output would order the creates,
 *   but Alchemy skips the adoption probe while any prop is one (Plan.ts), so the first deploy after
 *   the bootstrap would plan `create` for objects that are all there. Order never matters here:
 *   nothing in this package can run before the bootstrap, and after it everything exists.
 */
import { adopt } from 'alchemy/AdoptPolicy';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { ProxmoxAcl } from './acl.ts';
import type { PveTarget } from './credentials.ts';
import { ProxmoxGroup } from './group.ts';
import { type ProvisionNames, provisionBaseline } from './provision-baseline.ts';
import { ProxmoxRole } from './role.ts';
import { ProxmoxUser } from './user.ts';

export interface DeclareProvisionOptions {
  /** `true`/`false` pipe `adopt(…)` onto every resource; omitted, the deploy's policy decides. */
  readonly adopt?: boolean;
}

/**
 * The baseline for one cluster. `id` prefixes every logical id (`<id>-role`, `<id>-mint-group`,
 * `<id>-provision-user`, `<id>-provision-grant`, and the `read` pair), so one stack can declare a
 * baseline per cluster. `users` and `grants` come back in `baseline.users` / `baseline.grants`
 * order: provision, then read. Fails, before declaring anything, on a name the baseline refuses.
 */
export const declareProvisionBaseline = (
  id: string,
  target: PveTarget,
  names: ProvisionNames = {},
  options: DeclareProvisionOptions = {},
) =>
  Effect.gen(function* () {
    const baseline = yield* Effect.try({
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      try: () => provisionBaseline(names),
    });
    const owned = <A, R>(resource: Effect.Effect<A, never, R>) => {
      const kept = resource.pipe(RemovalPolicy.retain());
      return options.adopt === undefined ? kept : kept.pipe(adopt(options.adopt));
    };
    const role = yield* owned(
      ProxmoxRole(`${id}-role`, {
        privs: [...baseline.role.privs],
        roleid: baseline.role.roleid,
        target,
      }),
    );
    const group = yield* owned(ProxmoxGroup(`${id}-mint-group`, { ...baseline.group, target }));
    // ★ `Effect.all` over mapped declarations (sequential), as cloudflare-permission-groups.ts does:
    //   oxlint's unicorn/no-array-for-each cannot tell `Effect.forEach` from `Array#forEach`.
    const users = yield* Effect.all(
      baseline.users.map((user) =>
        owned(
          ProxmoxUser(`${id}-${user.lane}-user`, {
            comment: user.comment,
            groups: [...user.groups],
            target,
            userid: user.userid,
          }),
        ),
      ),
    );
    const grants = yield* Effect.all(
      baseline.grants.map((grant) =>
        owned(
          ProxmoxAcl(`${id}-${grant.lane}-grant`, {
            path: '/',
            propagate: true,
            roleid: grant.roleid,
            target,
            type: 'user',
            ugid: grant.userid,
          }),
        ),
      ),
    );
    return { baseline, grants, group, role, users };
  });
