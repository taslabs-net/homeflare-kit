/**
 * Permission-group (name, SCOPE) → ID, behind ONE interface with two sources.
 *
 * ⛔ THE KEY IS THE PAIR, AND THAT IS NOT PEDANTRY. MEASURED 2026-09-15 the hour the grant went
 *   live: of the account's 401 groups, SEVEN names are listed twice — `Access: Apps and Policies
 *   Read`/`Revoke`/`Write`, `Disable ESC Read`/`Write`, `Logs Read`/`Write` — each pair one id
 *   scoped `com.cloudflare.api.account` and one scoped `com.cloudflare.api.account.zone`. Keyed by
 *   name alone the whole plan fails as ambiguous; keyed by name alone and forgiving, cfhf.py:148's
 *   last-one-wins picks a group gated at the wrong scope and the token is refused at first use.
 *   The asking ENTRY says which: its `scope` (roles.yaml `groups_scope:`), else its resource.
 *
 * ★ A SERVICE, NOT A TABLE. roles.yaml names groups (`DNS Read`); a role stores IDs. apply-roles.py
 *   resolved them per account with a Cloudflare parent credential (cfhf.py:147-148), which agents
 *   may not use. So Bao.CloudflareRole asks this service, and the stack chooses the source:
 *
 *   a) `permissionGroupsFromEngine` — `GET <mount>/permission-groups` on the Cloudflare engine,
 *      answered under the mount's own parent. ★ DEPLOYED AND WIRED 2026-09-15: `bao path-help
 *      cloudflare-<account>-platform` lists `^permission-groups$` on plugin v0.0.0-dev, and
 *      cloudflare-roles.ts now provides this source to the stack.
 *   b) `permissionGroupsFromLiveRoles` — ⚠️ TEMPORARY, AND STILL HERE ON PURPOSE. 2026-09-15: no
 *      longer the stack's source, and NOT yet deletable. Two things gate that — (1) the live
 *      `result_info` envelope pinned in ../../platform/secrets/vault/plugin/cloudflare/
 *      client_result_info.go, whose own header names this deletion as what it gates, and (2)
 *      cloudflare-parity.ts, which calls cloudflare-permission-groups-solve.ts directly for the
 *      OFFLINE proof against a production export and has no engine to ask. So (b) and the solver
 *      stay, one import from being the layer again (cloudflare-roles.ts), until the last step of
 *      docs/ledger/openbao-permission-groups-engine-2026-09-15.md is done.
 *
 * ⛔ AN UNKNOWN NAME FAILS THE OPERATION. Dropping it would write a policy one group short, and the
 *   engine refuses an empty ID (path_roles.go:181-185) but not a SHORTER list: the minted token is
 *   quietly narrower than declared, and the consumer finds out at 403.
 */
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { baoRead } from './bao-http.ts';
import type { BaoError } from './bao-status.ts';
import { groupKey } from './cloudflare-group-scope.ts';
import {
  describeProblems,
  observationsOf,
  solveGroups,
} from './cloudflare-permission-groups-solve.ts';
import { type WirePolicy, atEveryScope } from './cloudflare-policy.ts';
import { readCloudflareRole } from './cloudflare-role-wire.ts';
import type { ExpandedRole } from './cloudflare-roles-expand.ts';
import { mountPath } from './mount-form.ts';

export class CloudflareGroupsError extends Error {
  constructor(
    readonly scope: string,
    readonly problems: readonly string[],
  ) {
    super(`Cloudflare permission groups for ${scope}: ${problems.join('; ')}`);
    this.name = 'CloudflareGroupsError';
  }
}

/** ⛔ Keyed by `groupKey(name, scope)` throughout — see cloudflare-group-scope.ts. */
type Groups = ReadonlyMap<string, string>;
type Lookup = Effect.Effect<Groups, BaoError | CloudflareGroupsError, HttpClient.HttpClient>;

/** One group a role asks for: its name, and the scope the entry naming it is gated at. */
export interface GroupRef {
  readonly name: string;
  readonly scope: string;
}

export class CloudflarePermissionGroups extends Context.Service<
  CloudflarePermissionGroups,
  {
    /** The ID of every ref, keyed by `groupKey` — or a failure naming what did not resolve. */
    readonly resolve: (
      mount: string,
      refs: readonly GroupRef[],
    ) => Effect.Effect<Groups, BaoError | CloudflareGroupsError, HttpClient.HttpClient>;
  }
>()('homeflare/openbao/CloudflarePermissionGroups') {}

const pick = (mount: string, groups: Groups, refs: readonly GroupRef[], hint: string) => {
  const unknown = refs.filter((ref) => !groups.has(groupKey(ref.name, ref.scope)));
  if (unknown.length > 0) {
    const problems = unknown.map(
      (ref) => `unknown group ${JSON.stringify(ref.name)} at scope ${ref.scope} — ${hint}`,
    );
    return Effect.fail(new CloudflareGroupsError(mount, problems));
  }
  return Effect.succeed(
    new Map(
      refs.flatMap((ref) => {
        const key = groupKey(ref.name, ref.scope);
        const id = groups.get(key);
        return id === undefined ? [] : [[key, id] as const];
      }),
    ),
  );
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * ⛔ A 403 IS A MISSING GRANT, AND IT SAYS SO. `BaoError` alone reports `GET /v1/<mount>/
 *   permission-groups -> 403: permission denied` — true, and it points nowhere: the path is
 *   deployed, the token is valid, and the one thing to change is a policy file. MEASURED 2026-09-15
 *   10:19 on the host's admin lane, where `bao write sys/capabilities-self` answered `[deny]` on
 *   this exact path. bao-status.ts argues that a failure must name what it is; this is that
 *   argument one level up.
 */
const deniedHint = (mount: string) =>
  `GET ${mountPath(mount)}/permission-groups answered 403 — this token's policy carries no ` +
  `\`path "${mountPath(mount)}/permission-groups" { capabilities = ["read"] }\` grant. ` +
  'It is declared in ../platform/secrets/vault/policies/homeflare-admin/' +
  '20-cloudflare-permission-groups.hcl and applies with `alchemy deploy` of this stack';

const deniedNamed = <A, R>(mount: string, read: Effect.Effect<A, BaoError, R>) =>
  Effect.catchIf(
    read,
    (error) => error.status === 403,
    () => Effect.fail(new CloudflareGroupsError(mount, [deniedHint(mount)])),
  );

/**
 * a) The engine's list, parsed.
 *
 * ★ THE SHAPE IS THE PLUGIN'S OWN, READ FROM ITS SOURCE 2026-09-15:
 *   `{"permission_groups":[{"id","name","scopes"}]}` built row by row in
 *   ../../platform/secrets/vault/plugin/cloudflare/path_permission_groups.go:42-54. baoRead takes
 *   `data` when the body has one and the whole body otherwise (bao-http.ts:160-167), so either
 *   envelope parses.
 * ⚠️ PAGINATION IS THE PLUGIN'S PROBLEM, NOT THIS PARSER'S. client_permission_groups.go:52-119 walks
 *   Cloudflare's pages and ends every guard in an error rather than a shorter list, so what arrives
 *   here is complete or absent. ⛔ ITS `result_info` GUARDS ARE STILL UNMEASURED against a live
 *   envelope (client_result_info.go:22-28) — that capture, not this file, is what gates deleting (b).
 * ⛔ ONE NAME WITH TWO IDS IS NOT AN ERROR; ONE (NAME, SCOPE) WITH TWO IDS IS. cfhf.py:148 built
 *   `{g["name"]: g["id"]}` and the LAST duplicate won in silence. MEASURED 2026-09-15 on the live
 *   list: seven names ARE listed twice, each pair one account-scoped id and one zone-scoped id, so
 *   the plugin's "does not choose between them" (path_permission_groups.go:69-70) is the shape in
 *   front of us, not a hypothetical. `scopes` tells them apart; the header above says who picks.
 * ⚠️ AN EMPTY `scopes` IS NOT AN ERROR. Such a group is reachable only by the one-id rule below —
 *   a name nothing else claims answers wherever it is asked — so a group Cloudflare ships without
 *   a scope resolves, and never holds the other 398 hostage.
 */
const engineGroups = (mount: string): Lookup =>
  Effect.flatMap(deniedNamed(mount, baoRead(`${mountPath(mount)}/permission-groups`)), (data) => {
    const list = data?.['permission_groups'];
    if (data === undefined) {
      // ⚠️ 404 IS NOW A MOUNT-SHAPED ANSWER, NOT THE EXPECTED ONE. The path IS deployed
      //   estate-wide (measured 2026-09-15), so a 404 here means this mount is served by an older
      //   plugin binary or BAO_ADDR is not the vault host — never "no groups".
      const why = 'GET <mount>/permission-groups answered 404 — the endpoint is not deployed here';
      return Effect.fail(new CloudflareGroupsError(mount, [why]));
    }
    if (!Array.isArray(list)) {
      return Effect.fail(new CloudflareGroupsError(mount, ['no permission_groups array in reply']));
    }
    const scoped = new Map<string, string>();
    const idsOf = new Map<string, Set<string>>();
    const problems: string[] = [];
    for (const item of list) {
      const name = isRecord(item) ? item['name'] : undefined;
      const id = isRecord(item) ? item['id'] : undefined;
      const scopes = isRecord(item) ? item['scopes'] : undefined;
      if (
        typeof name !== 'string' ||
        typeof id !== 'string' ||
        !Array.isArray(scopes) ||
        !scopes.every((scope) => typeof scope === 'string')
      ) {
        problems.push('an entry without a string name, id and scopes');
        continue;
      }
      idsOf.set(name, (idsOf.get(name) ?? new Set()).add(id));
      for (const scope of scopes) {
        const key = groupKey(name, scope);
        if (scoped.has(key) && scoped.get(key) !== id) {
          problems.push(
            `ambiguous: ${JSON.stringify(name)} is listed with two ids at scope ${scope}`,
          );
        } else {
          scoped.set(key, id);
        }
      }
    }
    /**
     * ★ A NAME WITH ONE ID NEEDS NO SCOPE, and answers at every scope an entry can ask for: there
     *   is nothing to choose between, and 385 of the list's 392 names are in that case. It is only
     *   the seven two-id names the asking scope has to separate — and for those, a scope the name
     *   is not listed at resolves to nothing and fails by name, never to the other scope's id.
     */
    const sole = new Map(
      [...idsOf].flatMap(([name, ids]) => {
        const only = [...ids];
        return ids.size === 1 && only[0] !== undefined ? [[name, only[0]] as const] : [];
      }),
    );
    return problems.length > 0
      ? Effect.fail(new CloudflareGroupsError(mount, problems))
      : Effect.succeed(new Map([...atEveryScope(sole), ...scoped]));
  });

/**
 * ★ ONE FETCH PER MOUNT PER RUN, not one per role — 586 roles would otherwise ask 586 times.
 * ⚠️ A FAILURE IS CACHED TOO (Effect.cached keeps the Exit), so one sealed-vault 503 fails every
 *   role on that mount for the rest of the run. That is the honest outcome for a plan: retrying
 *   586 times against a sealed server would only make the failure slower.
 */
export const permissionGroupsFromEngine = () =>
  Effect.sync(() => {
    const cache = new Map<string, Lookup>();
    const cachedFor = (mount: string) =>
      Effect.suspend(() => {
        const hit = cache.get(mountPath(mount));
        if (hit !== undefined) return hit;
        return Effect.flatMap(Effect.cached(engineGroups(mount)), (lookup) => {
          cache.set(mountPath(mount), lookup);
          return lookup;
        });
      });
    return CloudflarePermissionGroups.of({
      resolve: (mount, refs) =>
        Effect.flatMap(cachedFor(mount), (groups) =>
          pick(mount, groups, refs, 'the engine does not list it for this account at that scope'),
        ),
    });
  });

/**
 * b) ⚠️ TEMPORARY, AND NO LONGER THE STACK'S SOURCE SINCE 2026-09-15 — see the header for the two
 *   things that gate deleting it. Reads every DECLARED role of an account — no LIST, because an
 *   undeclared live role carries IDs with no names to pair them with — and solves the account at
 *   once.
 * 🔴 WHAT RETIRED IT, 2026-09-15 10:13: `alchemy deploy` could not create
 *   `cloudflare-{<account>,testing}-platform/roles/r2-backup-host` — `unknown group "Workers R2
 *   Storage Bucket Item Write" — no live role on account <account> carries it; a NEW group needs
 *   the engine endpoint`. That is this source's documented blind spot arriving, not a bug in it.
 *
 * ★ PER ACCOUNT, NOT PER MOUNT, BECAUSE ONE MOUNT CANNOT SOLVE ITSELF. MEASURED on the snapshot:
 *   `aimto-app-alchemy-os-create` on the platform mount pairs `Email Routing Rules Write` and
 *   `DNS Write` with two unknown IDs, and neither group appears alone on that mount. The dns and
 *   security mounts of the same account isolate them. apply-roles.py's map was per account too
 *   (apply-roles.py:117).
 */
export const permissionGroupsFromLiveRoles = (
  declared: ReadonlyMap<string, readonly ExpandedRole[]>,
) =>
  Effect.gen(function* () {
    const accountOf = new Map<string, string>();
    const byAccount = new Map<string, ExpandedRole[]>();
    for (const [mount, roles] of declared) {
      for (const role of roles) {
        accountOf.set(mount, role.account);
        byAccount.set(role.account, [...(byAccount.get(role.account) ?? []), role]);
      }
    }
    const solved = new Map<string, Lookup>();
    for (const [account, roles] of byAccount) {
      const solve = Effect.gen(function* () {
        const live = new Map<string, readonly WirePolicy[]>();
        // ★ `Effect.all` over mapped reads, not `Effect.forEach`: oxlint's unicorn/no-array-for-each
        //   matches the method NAME and cannot tell Effect's from Array's.
        yield* Effect.all(
          roles.map((role) =>
            Effect.map(readCloudflareRole(role.mount, role.name), (read) => {
              if (read?.policies !== undefined) {
                live.set(`${role.mount}/${role.name}`, read.policies);
              }
            }),
          ),
          { concurrency: 8, discard: true },
        );
        const result = solveGroups(observationsOf(roles, live));
        const problems = describeProblems(result);
        if (problems.length > 0) {
          return yield* Effect.fail(new CloudflareGroupsError(`account ${account}`, problems));
        }
        /**
         * ⚠️ IT ANSWERS AT EVERY SCOPE BECAUSE IT CANNOT SEE ONE. A live role carries ids and no
         *   scopes, so the solver learns `name → id` and nothing more; the seven two-id names
         *   resolve here to whichever id the estate happens to carry, at whatever scope is asked.
         *   That is this source's blind spot, not a second opinion — (a) keys by (name, scope).
         */
        return atEveryScope(result.groups);
      });
      solved.set(account, yield* Effect.cached(solve));
    }
    return CloudflarePermissionGroups.of({
      resolve: (mount, refs) => {
        const account = accountOf.get(mountPath(mount));
        const lookup = account === undefined ? undefined : solved.get(account);
        if (account === undefined || lookup === undefined) {
          const why = 'no declared role on this mount, so no live role can vouch for its groups';
          return Effect.fail(new CloudflareGroupsError(mount, [why]));
        }
        const hint = `no live role on account ${account} carries it; a NEW group needs the engine endpoint`;
        return Effect.flatMap(lookup, (groups) => pick(mount, groups, refs, hint));
      },
    });
  });
