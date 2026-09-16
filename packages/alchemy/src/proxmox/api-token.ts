/**
 * `Proxmox.ApiToken` — a PVE API token: the thing a service actually authenticates as.
 *
 * ⛔ THE SECRET EXISTS FOR ONE HTTP RESPONSE AND THEN NOWHERE. MEASURED from the cluster's own
 *   schema (`/usr/share/pve-docs/api-viewer/apidoc.js` on n2, 2026-09-13): POST returns
 *   `["full-tokenid","info","value"]`; PUT returns `["comment","expire","full-tokenid","privsep",
 *   "value"]` with `value` present ONLY when `regenerate` was set; GET returns
 *   `["comment","expire","privsep"]` and never the secret. A live token agrees —
 *   `GET /access/users/monitoring@pve/token/exporter` answers `{"expire":0,"privsep":0}`. PVE says
 *   it plainly on the POST: the value "needs to be stored as it cannot be retrieved afterwards".
 *
 * ⛔ SO A TOKEN THIS RESOURCE CREATES IS UNUSABLE, AND SAYING SO IS THE POINT OF THIS BLOCK. The
 *   secret may not become an attribute: Alchemy persists attributes UNENCRYPTED, and this estate's
 *   state store is a Postgres dumped nightly (the ⛔ in credentials.ts). So `reconcile` drops the
 *   value on the floor, and what lands is a live credential in `/etc/pve/user.cfg` whose secret
 *   nobody holds. No `regenerate` rescues it, because a regenerated value is discarded the same
 *   way. The only escape is an operator who captured the value out of band — which this provider
 *   gives them no way to do.
 *   ★ SO POINT THIS FAMILY AT TOKENS THAT ALREADY EXIST. `comment`, `expire` and `privsep` are the
 *     whole of a token's policy, and declaring them is real work: it is how `expire` stops being
 *     whatever somebody typed in 2024. Mint NEW tokens where the secret can be caught — OpenBao's
 *     `proxmox-tb4` mount, or a human at `pveum user token add`.
 *   ⚠️ THE CREATE PATH IS LEFT REACHABLE RATHER THAN STUBBED. A create that silently did nothing
 *     would be the same lie as the stubbed delete resource.ts's ★ refuses; the honest arrangement
 *     is a create that works and a header that says what it produces.
 *
 * ⛔ THERE IS NO `regenerate` PROP, AND IT IS NOT AN OVERSIGHT. PVE's own description: "All users
 *   of the previous secret will lose access after this operation." A prop for it would revoke a
 *   live credential during a deploy whose plan said `update`, and hand back a replacement this
 *   provider is obliged to throw away — breakage with no recovery. Rotation belongs to the mount
 *   that owns the lease, or to a human who is watching.
 *
 * ⚠️ THERE IS A SECOND WRITER TO THESE OBJECTS AND IT IS THE ONE THIS PROVIDER RUNS ON. OpenBao's
 *   `proxmox-tb4` engine mints PVE tokens under `hf-read@pve` and `hf-provision@pve` — read from
 *   `house/platform/secrets/vault/plugin-proxmox/proxmox/`: `privsep=0` (client.go), `expire` set
 *   to the lease deadline, and an id the plugin CHOOSES,
 *   `hf-<role>-<actor>-<entity6>-<stamp>-<nonce>` (tokenname.go). Revocation and WAL rollback look
 *   up that one exact id (wal.go); neither sweeps a prefix. So the two systems cannot collide on
 *   one object by accident — but they share the USER: `hf-read@pve` held three live leases when
 *   this was written, and `Proxmox.User` deleting that account takes every one of them with it.
 *   ⛔ DO NOT DECLARE A TOKEN UNDER A MINT USER. `expire` is what makes that dangerous rather than
 *     untidy: point this resource at a lease token with the wrong expire and a 300-second
 *     credential becomes a permanent one — and on `hf-provision@pve` that credential carries
 *     `Permissions.Modify` at `/`. docs/privileges.md records what those 27 privileges buy.
 *
 * ⚠️ PRIVILEGES, AND THE READ LANE CANNOT DO IT. MEASURED: all four methods on this path check
 *   `['or', ['userid-param','self'], ['userid-group', ['User.Modify']]]` — with no `Sys.Audit`
 *   alternative, unlike `GET /access/users/{userid}`, which has one. And
 *   `pvesh get /access/permissions --userid hf-read@pve --path /access/groups` answers the seven
 *   PVEAuditor audit privileges and no `User.Modify`, while `hf-provision@pve` has it. So the
 *   3600s read lease reaches at most its OWN account's tokens and is refused for every other
 *   userid — which `read` in resource.ts folds into "absent", so the plan says create and the POST
 *   then fails with "Token already exists". Hence `readRole: 'provision'` below, for the same
 *   reason storage.ts, sdn-zone.ts and sdn-vnet.ts set it, at the same cost: every plan mints a
 *   300s non-renewable provision lease just to read.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { apiTokenSpec } from './api-token-form.ts';
import { type PveRequirements, type WithTarget, pveHandlers, pveOperations } from './resource.ts';

export interface ApiTokenProps extends WithTarget {
  /**
   * The account that owns the token, realm-qualified: `tofu@pve`, `root@pam`. Identity.
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
   * ⚠️ PVE HAS NO RENAME, AND HERE THAT COSTS MORE THAN IT DOES FOR A USER. Editing this prop (or
   *   `userid`) points `path` at a DIFFERENT token, which reads as absent and is then created —
   *   leaving the old token LIVE, with its secret still working, invisible to the plan, while the
   *   new one is the unusable kind described at the top. Rename by declaring a delete and a
   *   create, the way user.ts says for an account.
   *   ⛔ `diff` IS NOT OVERRIDDEN TO SAY `replace` THE WAY acl.ts DOES, AND THE DIFFERENCE IS THE
   *     OBJECT. There, replace removes a grant that can be rebuilt from its own tuple; here it
   *     would DELETE a live token — destroying an irrecoverable secret, and everything using it —
   *     to tidy up a name. Leaving the old token standing is the lesser harm, and saying so here
   *     is what keeps it from looking like an omission.
   * ⚠️ PATTERN `[A-Za-z][A-Za-z0-9.\-_]+`: a letter first, two characters minimum. The schema
   *   declares no maxLength; the OpenBao plugin assumes a conservative 64 rather than finding the
   *   real limit in production, and so should anything else.
   */
  tokenid: string;
  /**
   * Free text in `pveum user token list` and the UI. Empty is how it is cleared — see `shape`.
   * ⚠️ ANY CHARACTER IS SAFE HERE, MEASURED, and it was worth checking: `user.cfg` is a
   *   colon-delimited line, so a comment holding a colon or a newline is the obvious place for a
   *   round-trip to lose a character and diff forever. PVE escapes it — `encode_text` turns
   *   `a:b\nc%d` into `a%3Ab%0Ac%25d` and `decode_text` gives it back byte for byte.
   */
  comment?: string;
  /**
   * Seconds since the epoch, or 0 for "never expires".
   *
   * ⛔ REQUIRED, AND THE SCHEMA WILL TELL YOU IT NEED NOT BE. It declares the default "same as
   *   user", and the code never implements it: `generate_token` writes `expire` only when the
   *   parameter is defined, `user.cfg` stores a token as `token:<id>:<expire>:<privsep>:<comment>:`
   *   with no absent state, and the parser does `$expire = 0 if !$expire` (AccessControl.pm:1624).
   *   MEASURED end to end: every token on this cluster that was created without an expire reads
   *   back `"expire":0`. So "same as user" is documentation of an intention, not behaviour.
   * ⛔ WHICH IS WHY IT IS NOT OPTIONAL-DEFAULTING-TO-0. That spelling reads identically and is far
   *   worse: an omitted `expire` would then quietly WRITE 0 over a live deadline, turning an
   *   expiring credential into a permanent one, and the plan would call it an update. Requiring
   *   the field makes "this token never expires" a sentence somebody had to type.
   */
  expire: number;
  /**
   * True keeps the token's privileges separate from its owner's — it gets NOTHING until an ACL
   *   names `fullTokenid`. False gives it the owner's privileges entire.
   *
   * ⛔ REQUIRED FOR THE SAME REASON AS `expire`, AND THE BLAST RADIUS IS LARGER. PVE's API default
   *   is 1, every token on this cluster is 0 (measured), and `user.cfg` materialises it either way
   *   — `$privsep = $privsep ? 1 : 0` (AccessControl.pm:1622), so there is no unset state to
   *   preserve. Were this optional, adopting a live token without mentioning `privsep` would plan
   *   an update to 1 and STRIP a working credential of every privilege it has, silently: PVE
   *   returns 401/403 to the service, nothing errors here, and `tofu@pve!apply` simply stops
   *   working. Required, so adopting a token is a sentence that states what it is.
   * ⚠️ AND `false` IS NOT A SHRUG. It is a token with its owner's whole privilege set; under a
   *   provisioning account that is the account's full authority with a separate secret.
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
   *   credential, in clear, into the state Postgres and into every nightly dump of it — the exact
   *   leak metric-server.ts types its `token` as `never` to prevent. The read cannot supply one
   *   anyway; only create and regenerate can, and both of those responses are dropped.
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
 *   are one irreplaceable secret: delete it and the value is gone, a replacement is a DIFFERENT
 *   value, and every holder loses access the instant `cfs_write_file` returns — with no error
 *   raised anywhere near them. The live cluster's tokens are `monitoring@pve!exporter` (the PVE
 *   exporter feeding VictoriaMetrics), `mcp@pve!executor`, `tofu@pve!apply`, `tofu@pve!ro`,
 *   `sablier@pve!sablier` and `vaultmint@pve!engine` — the last being the parent credential the
 *   OpenBao mount itself authenticates with, so orphaning that one would stop every plan in this
 *   package, this resource included. `delete` is FULLY IMPLEMENTED (DELETE is a real method on
 *   this path, measured) and runs the moment a caller opts in with `.pipe(RemovalPolicy.destroy())`.
 *   See the ★ in resource.ts, which explains the convention once.
 */
export const ProxmoxApiToken = Resource<ProxmoxApiToken>('Proxmox.ApiToken', {
  defaultRemovalPolicy: 'retain',
});

const ops = pveOperations(apiTokenSpec);

/**
 * ⛔ THIS FAMILY ADOPTS AND MANAGES TOKENS; IT REFUSES TO MINT ONE, AND THAT IS A DECISION RATHER
 *   THAN A GAP. The secret exists ONLY in the create response — MEASURED from the schema: `POST`
 *   returns `["full-tokenid","info","value"]`, where `value` is "API token value used for
 *   authentication", while `GET` returns `["comment","expire","privsep"]` and never the secret.
 *   It may not become an attribute, because Alchemy writes attributes to its state store
 *   UNENCRYPTED into a Postgres that is dumped nightly.
 *
 *   So a token created here would be A LIVE CREDENTIAL ON THE CLUSTER THAT NOBODY HOLDS: valid,
 *   privileged, unusable, and indistinguishable from one somebody meant to keep. Regenerating does
 *   not rescue it — a `regenerate` PUT returns the new value down the same discarded path. So
 *   `reconcile` refuses by name and says what to do instead.
 *
 * ★ EVERYTHING ELSE STILL WORKS, AND IT IS THE HALF WORTH HAVING. Adopting an existing token and
 *   converging its `comment`, `expire` and `privsep` are real operations: TB4 carries SEVEN tokens
 *   with `expire=0` and `privsep=0` made by clicks nobody recorded. Declaring those freezes the
 *   set, and an eighth appearing shows up as drift.
 *
 * ⚠️ IF DECLARATIVE MINTING IS EVER WANTED, the missing piece is a secret SINK — write the value
 *   straight into an OpenBao kv path and return only its address. That is a different resource
 *   with a different contract; it must not be bolted onto this one.
 */
const handlers = {
  ...pveHandlers(apiTokenSpec),
  reconcile: Effect.fn(function* ({ news }: { news: ApiTokenProps }) {
    const live = yield* ops.read(news);
    if (live === undefined) {
      return yield* Effect.die(
        new Error(
          `${news.userid}!${news.tokenid}: this resource does not create API tokens. PVE returns ` +
            'the secret only in the create response and it cannot be stored, so a token made here ' +
            'would be a live credential nobody holds. Create it with `pveum user token add` and ' +
            'capture the value, or mint a short-lived one from the OpenBao proxmox mount ' +
            '(`bao read proxmox-tb4/creds/<role>`) -- then declare it here to manage it.',
        ),
      );
    }
    return yield* ops.reconcile(news);
  }),
};

/**
 * ⛔ `list` IS EMPTY, AND FOR THIS FAMILY THAT MATTERS MORE THAN THE GENERIC ARGUMENT IN
 *   resource.ts. A token index handed to Alchemy would offer up `vaultmint@pve!engine` and every
 *   live OpenBao lease for adoption — and adoption is what makes a later plan willing to delete.
 *   The mount's leases in particular appear and vanish on their own; anything that adopted one
 *   would report drift against a credential that was never its to hold.
 */
export const ProxmoxApiTokenProvider = () =>
  Provider.effect(ProxmoxApiToken, Effect.succeed(ProxmoxApiToken.Provider.of(handlers)));
