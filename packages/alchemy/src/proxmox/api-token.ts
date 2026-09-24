/**
 * `Proxmox.ApiToken` — a PVE API token: the thing a service actually authenticates as.
 *
 * ⛔ THE SECRET EXISTS FOR ONE HTTP RESPONSE AND THEN NOWHERE. MEASURED from the cluster's own
 *   schema: POST returns `["full-tokenid","info","value"]`; PUT returns `["comment","expire",
 *   "full-tokenid","privsep","value"]` with `value` present ONLY when `regenerate` was set; GET
 *   returns `["comment","expire","privsep"]` and never the secret. PVE says it plainly on the
 *   POST: the value "needs to be stored as it cannot be retrieved afterwards".
 *
 * ⛔ SO A TOKEN THIS RESOURCE CREATES IS UNUSABLE, AND SAYING SO IS THE POINT OF THIS BLOCK. The
 *   secret may not become an attribute: Alchemy persists attributes UNENCRYPTED, and this estate's
 *   state store is a Postgres dumped nightly (the ⛔ in credentials.ts). So `reconcile` refuses
 *   before any POST, and what would land is a live credential in `/etc/pve/user.cfg` whose secret
 *   nobody holds. No `regenerate` rescues it, because a regenerated value is discarded the same
 *   way. The only escape is an operator who captured the value out of band — which this provider
 *   gives them no way to do.
 *   ★ SO POINT THIS FAMILY AT TOKENS THAT ALREADY EXIST. `comment`, `expire` and `privsep` are the
 *     whole of a token's policy, and declaring them is real work: it is how `expire` stops being
 *     whatever somebody typed in 2024. Mint NEW tokens where the secret can be caught — OpenBao's
 *     `proxmox-c1` mount, or a human at `pveum user token add`.
 *
 * ⛔ THERE IS NO `regenerate` PROP, AND IT IS NOT AN OVERSIGHT. PVE's own description: "All users
 *   of the previous secret will lose access after this operation." A prop for it would revoke a
 *   live credential during a deploy whose plan said `update`, and hand back a replacement this
 *   provider is obliged to throw away — breakage with no recovery.
 *
 * ⚠️ THERE IS A SECOND WRITER TO THESE OBJECTS AND IT IS THE ONE THIS PROVIDER RUNS ON. OpenBao's
 *   `proxmox-c1` engine mints PVE tokens under `hf-read@pve` and `hf-provision@pve` with an id it
 *   CHOOSES (`hf-<role>-<actor>-<entity6>-<stamp>-<nonce>`), so the two systems cannot collide on
 *   one object by accident — but they share the USER, and `Proxmox.User` deleting that account
 *   takes every one of its tokens with it. ⛔ DO NOT DECLARE A TOKEN UNDER A MINT USER: `expire`
 *   is what makes that dangerous — a 300-second lease token becomes a permanent one.
 *
 * ⚠️ PRIVILEGES, AND THE READ LANE CANNOT DO IT. MEASURED: all four methods on this path check
 *   `['or', ['userid-param','self'], ['userid-group', ['User.Modify']]]` — with no `Sys.Audit`
 *   alternative — so the 3600s read lease reaches at most its OWN account's tokens and is refused
 *   for every other userid. `readRole: 'provision'` below, for the same reason storage.ts,
 *   sdn-zone.ts and sdn-vnet.ts set it, at the same cost: every plan mints a 300s non-renewable
 *   provision lease just to read.
 *
 * ★ MIGRATED OFF `client.ts`'s generic `pve()`/`pveHandlers`/`pveOperations` ONTO
 *   `@distilled.cloud/proxmox`'s typed `access.getAccessUserToken`/`putAccessUserToken`/
 *   `deleteAccessUserToken` (2026-09-24, decision 43's proxmox walk-down, the last access-family
 *   resource). There is no `createAccessUserToken` call anywhere in this file — the create branch
 *   was already provably unreachable before the migration (`reconcile` dies on an absent read
 *   before any create path runs), so nothing calls distilled's POST-shaped `updateAccessUserToken`
 *   operation either; see api-token-form.ts for why the generator gave it that name.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as access from '@distilled.cloud/proxmox/access';
import * as Effect from 'effect/Effect';
import { API_TOKEN_UPDATE, attributesOf, matches, shape } from './api-token-form.ts';
import { guardWrite } from './distilled-guard.ts';
import type { PveRequirements, WithTarget } from './resource-spec.ts';
import { runPve } from './distilled-pve.ts';
import {
  UNREADABLE,
  type Unreadable,
  readOrUnreadable,
  unreadableWarning,
} from './unreadable-read.ts';

export interface ApiTokenProps extends WithTarget {
  /**
   * The account that owns the token, realm-qualified: `iac@pve`, `root@pam`. Identity.
   *
   * ⚠️ THE ACCOUNT MUST ALREADY EXIST. Every method here runs `check_user_exist` first, so a
   *   token named under a missing user fails the READ (folded to "absent") and then fails the
   *   create with "no such user" — the honest error, arriving one step after the misleading plan.
   *   Sequence a `Proxmox.User` ahead of it and the ordering takes care of itself.
   */
  userid: string;
  /**
   * The token's own name, unique within the account. Identity.
   *
   * ⚠️ PVE HAS NO RENAME. Editing this prop (or `userid`) points `path` at a DIFFERENT token,
   *   which reads as absent and is then created — leaving the old token LIVE, invisible to the
   *   plan, while the new one is the unusable kind described at the top. Rename by declaring a
   *   delete and a create.
   *   ⛔ `diff` IS NOT OVERRIDDEN TO SAY `replace` THE WAY acl.ts DOES: there, replace removes a
   *     grant that can be rebuilt from its own tuple; here it would DELETE a live token —
   *     destroying an irrecoverable secret — to tidy up a name. Leaving the old token standing is
   *     the lesser harm.
   * ⚠️ PATTERN `[A-Za-z][A-Za-z0-9.\-_]+`: a letter first, two characters minimum.
   */
  tokenid: string;
  /** Free text in `pveum user token list` and the UI. Empty is how it is cleared — see `shape`. */
  comment?: string;
  /**
   * Seconds since the epoch, or 0 for "never expires".
   *
   * ⛔ REQUIRED, AND THE SCHEMA WILL TELL YOU IT NEED NOT BE. It declares the default "same as
   *   user", and the code never implements it: `generate_token` writes `expire` only when the
   *   parameter is defined, and the parser does `$expire = 0 if !$expire`. Required, so "this
   *   token never expires" is a sentence somebody had to type, rather than an omission that would
   *   quietly WRITE 0 over a live deadline.
   */
  expire: number;
  /**
   * True keeps the token's privileges separate from its owner's — it gets NOTHING until an ACL
   *   names `fullTokenid`. False gives it the owner's privileges entire.
   *
   * ⛔ REQUIRED FOR THE SAME REASON AS `expire`, AND THE BLAST RADIUS IS LARGER. Were this
   *   optional, adopting a live token without mentioning `privsep` would plan an update to 1 and
   *   STRIP a working credential of every privilege it has, silently.
   */
  privsep: boolean;
}

export interface ApiTokenAttributes {
  userid: string;
  tokenid: string;
  /** `<userid>!<tokenid>` — what `Proxmox.Acl` binds as its `ugid`. Derived; never compared. */
  fullTokenid: string;
  comment: string;
  expire: number;
  privsep: boolean;
  /**
   * ⛔ THERE IS NO `value` FIELD HERE AND THERE NEVER MAY BE. Adding one would write a working PVE
   *   credential, in clear, into the state Postgres and into every nightly dump of it.
   */
}

export interface ProxmoxApiToken extends Resource<
  'Proxmox.ApiToken',
  ApiTokenProps,
  ApiTokenAttributes,
  never,
  PveRequirements
> {}

/**
 * ★ `retain` BY DEFAULT, AND THIS IS THE PLAINEST CASE FOR IT IN THE PACKAGE. A token's contents
 *   are one irreplaceable secret: delete it and the value is gone, and every holder loses access
 *   the instant `cfs_write_file` returns — with no error raised anywhere near them. `delete` is
 *   FULLY IMPLEMENTED and runs the moment a caller opts in with `.pipe(RemovalPolicy.destroy())`.
 */
export const ProxmoxApiToken = Resource<ProxmoxApiToken>('Proxmox.ApiToken', {
  defaultRemovalPolicy: 'retain',
});

/**
 * ⛔ `readRole: 'provision'` — see the header's ⚠️ on privileges.
 * ⛔ `{ userid, tokenid }`, NEVER THE WHOLE `props` — group.ts's readGroup has the full measured
 *   mechanism (kit 0.31.1's regression): an extra key beyond the schema's own path labels gets
 *   encoded onto this GET as a body, which a stricter fetch client refuses outright.
 * ⛔ NO `orElseSucceed` — a MISSING token's absence signal is a SUCCESSFUL read with `expire`/
 *   `privsep` both absent (`attributesOf`/api-token-form.ts, MEASURED pre-migration), unlike
 *   user.ts/group.ts's missing-object 500 — so this family never needed their folding split. A
 *   THROWN failure here is genuinely unexpected and must propagate and fail the plan loudly.
 */
const readToken = (props: ApiTokenProps) => {
  const label = { tokenid: props.tokenid, userid: props.userid };
  return readOrUnreadable(
    runPve(props.target, 'provision', false, access.getAccessUserToken(label)),
  ).pipe(Effect.map((live) => (live === UNREADABLE ? UNREADABLE : attributesOf(live, props))));
};

/** `read`/`reconcile` return `Attributes | undefined`; only `diff` tells `UNREADABLE` apart. */
const dropUnreadable = (live: ApiTokenAttributes | Unreadable | undefined) =>
  live === UNREADABLE ? undefined : live;

/**
 * ⛔ THIS FAMILY ADOPTS AND MANAGES TOKENS; IT REFUSES TO MINT ONE — see the header. `reconcile`
 *   refuses by name before any write when the read finds nothing, so the create path this
 *   family's spec would otherwise need never runs, and no `createAccessUserToken`-shaped call
 *   exists in this file at all.
 */
export const ProxmoxApiTokenProvider = () =>
  Provider.effect(
    ProxmoxApiToken,
    Effect.succeed(
      ProxmoxApiToken.Provider.of({
        /**
         * ⛔ `list` IS EMPTY, AND FOR THIS FAMILY THAT MATTERS MORE THAN THE GENERIC ARGUMENT.
         *   A token index handed to Alchemy would offer up `mint@pve!engine` and every live
         *   OpenBao lease for adoption — and adoption is what makes a later plan willing to delete.
         */
        list: () => Effect.succeed([]),
        read: Effect.fn(function* ({ olds }) {
          return dropUnreadable(yield* readToken(olds));
        }),
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          yield* guardWrite(API_TOKEN_UPDATE, shape(news), false);
          if (output === undefined) return undefined;
          const live = yield* readToken(news);
          // ⛔ THE CRIES-WOLF FIX: a refused read used to fall into `undefined` below and force
          //   `update` on a token that was plainly there — see unreadable-read.ts.
          if (live === UNREADABLE) {
            yield* unreadableWarning('Proxmox.ApiToken', `${news.userid}!${news.tokenid}`);
            return { action: 'noop' } as const;
          }
          // ⚠️ NO GUARDED-CREATE BRANCH HERE, UNLIKE EVERY OTHER FAMILY IN THIS SUB-AREA. There
          //   is nothing to guard a create form for — `reconcile` refuses instead, and `diff`
          //   answering `update` for an absent token is what routes a real deploy into that
          //   refusal rather than silently reporting `noop` over a token that never landed.
          return live !== undefined && matches(live, news)
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),
        reconcile: Effect.fn(function* ({ news }) {
          // ⚠️ `dropUnreadable`: reconcile only runs once `provision` already minted for the
          //   read that fed `diff`'s `update` verdict, so `UNREADABLE` here is a narrow race, not
          //   the routine case `diff` handles. Any OTHER read failure now propagates on its own
          //   (readToken no longer folds it), so the die() message below is reached only on a
          //   genuinely absent token, never on a transient failure wearing that message.
          const before = dropUnreadable(yield* readToken(news));
          if (before === undefined) {
            return yield* Effect.die(
              new Error(
                `${news.userid}!${news.tokenid}: this resource does not create API tokens. PVE ` +
                  'returns the secret only in the create response and it cannot be stored, so a ' +
                  'token made here would be a live credential nobody holds. Create it with ' +
                  '`pveum user token add` and capture the value, or mint a short-lived one from ' +
                  'the OpenBao proxmox mount (`bao read proxmox-c1/creds/<role>`) -- then declare ' +
                  'it here to manage it.',
              ),
            );
          }
          yield* guardWrite(API_TOKEN_UPDATE, shape(news), false);
          if (!matches(before, news)) {
            yield* runPve(news.target, 'provision', true, access.putAccessUserToken(shape(news)));
          }
          const after = dropUnreadable(yield* readToken(news));
          if (after === undefined) {
            return yield* Effect.die(
              new Error(
                `${news.userid}!${news.tokenid}: the write returned no error but the token is ` +
                  'still absent. PVE wraps every answer in {"data":...} and can report success ' +
                  'on a call that did nothing -- read back rather than trusting the status code.',
              ),
            );
          }
          return after;
        }),
        delete: Effect.fn(function* ({ olds }) {
          yield* runPve(
            olds.target,
            'provision',
            true,
            access.deleteAccessUserToken({ tokenid: olds.tokenid, userid: olds.userid }),
          );
        }),
      }),
    ),
  );
