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
 */
import type { PveSpec } from './resource.ts';
import { bool, int, text } from './values.ts';

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
 * Everything a token has, in the form PVE wants. Create and update send exactly this.
 *
 * ⛔ `userid` AND `tokenid` ARE NOT IN IT, and that is not an omission. Both are path segments of
 *   `access/users/{userid}/token/{tokenid}` — which is the path the POST goes to as well as the
 *   PUT — so a second copy in the body can only ever disagree with the path it was sent to.
 *   metric-server.ts omits its `id` for the same reason and says so there.
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
 *
 * ⚠️ `flag()` FROM values.ts IS DELIBERATELY NOT USED FOR `privsep`. Its entire job is turning an
 *   UNDECLARED boolean into `undefined` so the field is omitted from the form; `privsep` is a
 *   required prop precisely so that it is never undeclared, so there is nothing for it to do and
 *   its `string | undefined` return would have to be asserted away to fit `Record<string,string>`.
 *   An assertion here would be a claim about the prop that the type already makes properly.
 */
export const shape = (props: ApiTokenProps): Record<string, string> => ({
  comment: props.comment ?? '',
  expire: String(props.expire),
  privsep: props.privsep ? '1' : '0',
});

export const apiTokenSpec: PveSpec<ApiTokenProps, ApiTokenAttributes> = {
  // ⛔ THE ITEM READ NEEDS `User.Modify`, WHICH THE AUDITOR-SHAPED READ LEASE DOES NOT HAVE. The
  //   measurement and the consequence are in the header's last ⚠️; the mechanism — a silent
  //   "absent" rather than a 403 — is the ⛔ on `readRole` in resource.ts.
  readRole: 'provision',
  /**
   * ★ NOTHING PVE REPORTS HERE IS UNWRITABLE, WHICH IS UNUSUAL IN THIS PACKAGE AND IS WHY
   *   `matches` can compare everything it reads. The GET returns exactly `comment`, `expire` and
   *   `privsep`; PUT accepts exactly those three. There is no autoscaled field, no server-assigned
   *   id, no set whose order PVE reshuffles — the three killers the neighbouring files carry
   *   ⚠️s about do not arise. The two identity fields and `fullTokenid` come from props and are
   *   true by construction, so comparing them would be theatre.
   * ⚠️ `undefined` WHEN NEITHER FLAG IS THERE, BECAUSE BOTH ARE ALWAYS THERE. `user.cfg`
   *   materialises `expire` and `privsep` for every token it stores, so an answer carrying neither
   *   is not a token — and without this guard `bool`/`int` would invent one out of their fallbacks
   *   and the read-back guard in `reconcile` could never fire.
   */
  attributes: (live, props) => {
    const expire = live['expire'];
    const privsep = live['privsep'];
    if (expire === undefined && privsep === undefined) return undefined;
    return {
      comment: text(live['comment']),
      expire: int(expire, 0),
      fullTokenid: fullTokenid(props),
      /** ⚠️ FALLBACK `true`, MATCHING PVE'S API DEFAULT — unreachable given the guard above, but
       *   wrong in the safe direction if a future release stops emitting the field. */
      privsep: bool(privsep, true),
      tokenid: props.tokenid,
      userid: props.userid,
    };
  },
  /**
   * ⛔ THE SAME STRING AS `path`, AND NOT A TYPO. A token is POSTed to its OWN url, not to the
   *   collection: MEASURED, `/access/users/{userid}/token` carries a GET and nothing else, while
   *   POST lives on `{tokenid}`. metric-server.ts has the identical shape for the identical
   *   reason and records the experiment there.
   */
  collection: (props) => `access/users/${props.userid}/token/${props.tokenid}`,
  createForm: shape,
  /** The vendor rules both forms are checked against at plan time — resource-spec.ts. */
  endpoint: {
    create: 'pve:POST /access/users/{userid}/token/{tokenid}',
    update: 'pve:PUT /access/users/{userid}/token/{tokenid}',
  },
  /**
   * ⚠️ EXACTLY THE THREE FIELDS A PUT CAN PUT BACK, WHICH IS ALSO EXACTLY WHAT THE GET REPORTS.
   *   MEASURED, by replaying these two functions over the live GET bodies of all four token
   *   shapes this cluster has: `metrics@pve!exporter` (no comment), `iac@pve!apply` and
   *   `app@pve!app` (commented), and a live OpenBao lease under `hf-read@pve` (a real
   *   non-zero `expire`, offered as both `1789327175` and `"1789327175"` since `int` must not care
   *   which). All four answer noop; flipping `privsep` answers update; an empty body answers
   *   absent. ⚠️ THAT IS THE COMPARISON, NOT THE ENGINE — no `alchemy plan` was run against this
   *   family, and nothing here was written to the cluster.
   */
  matches: (attributes, props) =>
    attributes.comment === (props.comment ?? '') &&
    attributes.expire === props.expire &&
    attributes.privsep === props.privsep,
  path: (props) => `access/users/${props.userid}/token/${props.tokenid}`,
  updateForm: shape,
};
