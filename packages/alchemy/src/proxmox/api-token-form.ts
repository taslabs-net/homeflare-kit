import type { ApiTokenAttributes, ApiTokenProps } from './api-token.ts';
/**
 * What a write to a PVE API token actually does, and the form that does it.
 *
 * ★ SPLIT OUT OF api-token.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, and the seam is the one
 *   metric-server-form.ts draws: this file answers "what does PVE store when this form arrives",
 *   api-token.ts answers "what a token is and when it has changed". Nothing here reads the
 *   cluster and nothing here decides a diff.
 *
 * ⚠️ THE `import type` BACK TO api-token.ts IS A CYCLE ON PAPER ONLY. It is type-only, so it is
 *   erased before anything runs and `ApiTokenProps` stays in the file that declares the resource.
 *
 * ⛔ THE WRITE SEMANTICS BELOW ARE READ FROM THE CLUSTER'S OWN PERL RATHER THAN INFERRED FROM THE
 *   API SCHEMA — `/usr/share/perl5/PVE/API2/User.pm`, subs `generate_token` and
 *   `update_token_info`, read over SSH on node-b on 2026-09-13. The two disagree in exactly the place
 *   that costs a forever-diff: the schema gives `expire` the default "same as user", and the code
 *   never implements it. api-token.ts records what that means.
 *
 * ★ MIGRATED OFF THE GENERATED `generated/pve.ts` PARAM TYPES ONTO `@distilled.cloud/proxmox`'s
 *   typed `access.PutAccessUserTokenRequest`/`access.GetAccessUserTokenResponse` (2026-09-24) —
 *   the same three fields, still form-urlencoded strings on the wire; distilled's generator
 *   reads the identical vendor schema `generated/pve.ts` came from.
 */
import type * as access from '@distilled.cloud/proxmox/access';
import { bool, int, text } from './values.ts';

export const API_TOKEN_UPDATE = 'pve:PUT /access/users/{userid}/token/{tokenid}';

/**
 * `<userid>!<tokenid>` — the name the rest of PVE calls this object by.
 *
 * ★ IT IS WHAT AN ACL BINDS. `Proxmox.Acl` with `type: 'token'` wants exactly this string as its
 *   `ugid`, so reporting it as an attribute is what lets a privilege-separated token be granted
 *   anything at all without somebody retyping the join by hand.
 *
 * ⚠️ DERIVED, NOT READ. MEASURED: `GET /access/users/metrics@pve/token/exporter` answers
 *   `{"expire":0,"privsep":0}` and echoes back neither half of its own identity. So this is built
 *   from props, cannot disagree with the path the read used, and is therefore true by
 *   construction — which is why it is reported and never compared.
 */
export const fullTokenid = (props: ApiTokenProps) => `${props.userid}!${props.tokenid}`;

/**
 * Everything a token has, in the form PVE wants. Update sends exactly this (this family never
 * creates — see api-token.ts's header).
 *
 * ⚠️ EVERY FIELD IS SENT ON EVERY WRITE, THE EMPTY COMMENT INCLUDED, BECAUSE A PUT MERGES.
 *   MEASURED in `update_token_info`: `$token->{comment} = $param->{comment} if defined(...)`
 *   followed by `delete $token->{comment} if (!length $token->{comment})`. So `comment=` is how a
 *   comment is CLEARED; omitting it leaves the old text in place while `matches` goes on asking
 *   for an update the update cannot make. user.ts writes the same reasoning out for `groups`.
 *   ⚠️ THE `delete=` PARAMETER IS NOT USED AND WOULD NOT HELP. Its whitelist in that sub is
 *     literally `my $deletable = { comment => 1 };`, and anything else answers
 *     "unknown option '<k>'" — so `expire` and `privsep` have no clear path at all, which is the
 *     other half of why both are required props rather than optional ones.
 */
export const shape = (props: ApiTokenProps): access.PutAccessUserTokenRequest => ({
  comment: props.comment ?? '',
  expire: String(props.expire),
  privsep: props.privsep ? '1' : '0',
  tokenid: props.tokenid,
  userid: props.userid,
});

/**
 * ★ NOTHING PVE REPORTS HERE IS UNWRITABLE, WHICH IS UNUSUAL IN THIS PACKAGE. The GET returns
 *   exactly `comment`, `expire` and `privsep`; PUT accepts exactly those three.
 * ⛔ `undefined` WHEN NEITHER FLAG IS THERE, BECAUSE BOTH ARE ALWAYS THERE FOR A REAL TOKEN.
 *   `user.cfg` materialises `expire` and `privsep` for every token it stores, so an answer
 *   carrying neither is not a token — the same "distilled unwraps a missing object's `{"data":
 *   null}` to `{}`" trap group.ts's header measures, checked here the way this guard already was
 *   before the distilled migration (api-token.ts's ⛔ on the create refusal cites the same
 *   MEASURED schema). Without this guard `bool`/`int` would invent one out of their fallbacks and
 *   the read-back guard in `reconcile` could never fire.
 */
export const attributesOf = (
  live: access.GetAccessUserTokenResponse,
  props: ApiTokenProps,
): ApiTokenAttributes | undefined => {
  if (live.expire === undefined && live.privsep === undefined) return undefined;
  return {
    comment: text(live.comment),
    expire: int(live.expire, 0),
    fullTokenid: fullTokenid(props),
    /** ⚠️ FALLBACK `true`, MATCHING PVE'S API DEFAULT — unreachable given the guard above, but
     *   wrong in the safe direction if a future release stops emitting the field. */
    privsep: bool(live.privsep, true),
    tokenid: props.tokenid,
    userid: props.userid,
  };
};

/**
 * ⚠️ EXACTLY THE THREE FIELDS A PUT CAN PUT BACK, WHICH IS ALSO EXACTLY WHAT THE GET REPORTS.
 *   MEASURED (pre-migration, replaying against four live token shapes — see the old PR): all
 *   answer noop; flipping `privsep` answers update; an empty body answers absent.
 */
export const matches = (attributes: ApiTokenAttributes, props: ApiTokenProps) =>
  attributes.comment === (props.comment ?? '') &&
  attributes.expire === props.expire &&
  attributes.privsep === props.privsep;
