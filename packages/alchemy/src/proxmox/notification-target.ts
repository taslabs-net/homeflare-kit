/**
 * `Proxmox.NotificationTarget` — where a failed backup goes to be seen.
 *
 * ★ THE FAILURE MODE THIS REMOVES IS SILENCE. A failed vzdump, a lost HA service and a broken
 *   replication job all reach a human through one mechanism: a notification target. Out of the box
 *   a cluster has exactly one, the built-in `mail-to-root` — one mailbox, on one node, delivered by
 *   that node's local MTA. Declared, a failure becomes visible; undeclared, nothing looks wrong
 *   until somebody goes looking for a backup that was never taken. Every other resource in this
 *   package fails loudly. This is the one whose absence fails quietly.
 *
 * ⛔ THE PER-OBJECT READ GOES THROUGH `endpoints/{type}/{name}`, NEVER `targets/{name}`.
 *   `GET /cluster/notifications/targets/{name}` answers "Method not implemented" — MEASURED, and
 *   corroborated by the cluster's own apidoc, where that path node carries no methods at all.
 *   `/targets` is a READ-ONLY UNION VIEW implementing the collection GET and `{name}/test` and
 *   nothing else. So `type` is IDENTITY here, not a setting: it appears in both `path()` and
 *   `collection()`, and changing it is a replace rather than an update.
 *
 * ⚠️ A BUILT-IN TARGET CAN BE ADOPTED AND STILL NOT BE OWNED. The shipped entries report
 *   `origin: builtin` or `modified-builtin`, and a DELETE on one REVERTS it to shipped defaults
 *   instead of removing it: Alchemy drops the resource from state while the target is still on the
 *   cluster delivering mail. Check `origin` on `/cluster/notifications/targets` before declaring a
 *   name you did not create. ⚠️ `origin` IS DELIBERATELY NOT AN ATTRIBUTE — the schema returns it
 *   on the collection view only, never on the per-object read, so an attribute would read "unknown"
 *   for every object forever, and an attribute that always lies is worse than a true comment.
 *
 * ⛔ NO SECRET IS A PROP, LET ALONE AN ATTRIBUTE. smtp `password`, gotify `token` and webhook
 *   `secret` are write-only and none is declarable here. Props are persisted too, not just
 *   attributes — `delete` is handed `olds`, which can only have come from the state store — so a
 *   secret prop would sit unencrypted in the state Postgres for as long as the resource exists.
 *   ⚠️ THE COST IS REAL: `token` is REQUIRED on a gotify create, so a gotify target cannot be
 *     created from here at all. Create one out of band with its secret and then declare it — the
 *     read finds it, reconcile takes the PUT path, and PVE leaves any field the body does not
 *     mention alone. The secret half stays a human's; the rest is declared. Same for an
 *     authenticated smtp target and a signed webhook.
 *
 * ★ WHAT THIS NEEDS, READ OFF THE CLUSTER'S OWN SCHEMA:
 *     read/diff  GET endpoints/{type}/{name}  Mapping.Audit (or Mapping.Modify) on
 *                                             /mapping/notifications
 *     reconcile  POST + PUT                   Mapping.Modify on /mapping/notifications AND one of
 *                                             Sys.Audit / Sys.Modify / Sys.AccessNetwork on /
 *     delete     DELETE                       Mapping.Modify on /mapping/notifications
 *   The provision role already carried Sys.Audit on `/` (see lxc.ts), so the delta was the two
 *   Mapping privileges — notably NOT the `Sys.Modify` a backup job costs. `PROVISION_PRIVILEGES`
 *   carries both on `/`: the baseline took the trade below knowingly.
 *   ⚠️ PREFER A SECOND ROLE GRANTED AT `/mapping/notifications` OVER WIDENING THE PROVISIONING ROLE
 *     ON `/`. `/mapping` also holds the PCI and USB passthrough maps, so Mapping.Modify at the root
 *     lets a credential scoped to make containers rewire somebody's hardware.
 *   ⛔ THE OLD HAND CLIENT FOLDED 403 INTO "ABSENT": the plan said create, PVE refused the
 *     duplicate, and the fault was an ACL all along. Distilled now propagates that failure.
 *     Grant Mapping.Audit to the READ role before adopting; only typed NotFound means absent.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { PveRequirements, WithTarget } from './resource-spec.ts';
import { targetHandlers } from './notification-target-lifecycle.ts';

/** The four families PVE ships. `GET /cluster/notifications/endpoints` lists exactly these. */
export type NotificationTargetType = 'gotify' | 'sendmail' | 'smtp' | 'webhook';

/**
 * ⚠️ PVE'S OWN KEY NAMES, DASHES INCLUDED, for the reason backup-job.ts gives: the form is then a
 *   copy rather than a translation table, and a translation table is one more place for a key to be
 *   renamed and silently never sent.
 *
 * ⚠️ A FIELD THAT DOES NOT BELONG TO `type` IS STILL SENT, and PVE refuses it by name. That 400
 *   beats this file quietly dropping a `mailto` somebody wrote on a webhook.
 */
export interface NotificationTargetProps extends WithTarget {
  /** ⛔ IDENTITY: it picks the family AND the URL, so changing it is a replace. */
  type: NotificationTargetType;
  /**
   * PVE's primary key, unique ACROSS ALL FOUR FAMILIES: a webhook cannot be called `mail-to-root`,
   * because a sendmail target already is. Format `pve-configid`.
   */
  name: string;
  /** Free text in the UI. */
  comment?: string;
  /** Configured but not delivering. Always sent and always compared — see `shape`. */
  disable?: boolean;
  /** sendmail, smtp: recipients. ⚠️ Order is not meaning — see `addressList`. */
  mailto?: readonly string[];
  /** sendmail, smtp: PVE users, whose own configured address receives the mail. */
  'mailto-user'?: readonly string[];
  /** smtp: the SMTP host. gotify: the server URL. PVE requires it on create for both. */
  server?: string;
  /** smtp only. Unset lets PVE pick from `mode`: 465 tls, 587 starttls, 25 insecure. */
  port?: number;
  /** smtp only. PVE's schema default is `tls`. */
  mode?: 'insecure' | 'starttls' | 'tls';
  /** smtp only. ⛔ The matching `password` is not declarable — see the header. */
  username?: string;
  /** smtp: PVE requires it on create. sendmail: optional. */
  'from-address'?: string;
  /** Display name on the mail. PVE's smtp schema defaults it to `Proxmox VE`. */
  author?: string;
  /** webhook: PVE requires it on create. */
  url?: string;
  /** webhook: PVE requires it on create. Lower case — PVE's enum is `post|put|get`. */
  method?: 'get' | 'post' | 'put';
  /**
   * webhook: `name=<name>,value=<base64 of value>` property strings, as PVE stores them.
   * ⚠️ MORE THAN ONE HEADER IS THE ONE THING HERE NOT PROVEN ON A WIRE — see `REPEATED_KEY`.
   */
  header?: readonly string[];
  /**
   * webhook: the request body, base64, as PVE stores it.
   * ⚠️ THE UI SHOWS THE DECODED BODY AND THIS DOES NOT. Declaring the base64 is what keeps
   *   `matches` symmetric with the read; decoding for display would mean encoding on write, and a
   *   round trip PVE normalises differently is a forever-update. The cost is an unreadable diff.
   */
  body?: string;
}

/**
 * ⚠️ EVERY FIELD IS PRESENT FOR EVERY FAMILY, with `''` / `0` meaning "PVE holds nothing". A
 *   webhook reads back an empty `mailto`, which is also what a webhook declares, so the
 *   cross-family fields cost one comparison each and never a false update.
 */
export interface NotificationTargetAttributes {
  name: string;
  type: NotificationTargetType;
  comment: string;
  disable: boolean;
  /** Sorted and comma-joined, so re-ordering a declaration is not a diff. See `addressList`. */
  mailto: string;
  'mailto-user': string;
  server: string;
  /** 0 means PVE holds no port and will pick one from `mode`. */
  port: number;
  mode: string;
  username: string;
  'from-address': string;
  author: string;
  url: string;
  method: string;
  /** Sorted and comma-joined for COMPARISON only; the wire form differs. See `headerList`. */
  header: string;
  body: string;
}

export interface ProxmoxNotificationTarget extends Resource<
  'Proxmox.NotificationTarget',
  NotificationTargetProps,
  NotificationTargetAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxNotificationTarget = Resource<ProxmoxNotificationTarget>(
  'Proxmox.NotificationTarget',
);

/**
 * ⚠️ ON A BUILT-IN TARGET A DELETE REVERTS RATHER THAN REMOVES, and PVE reports success either way.
 *   It is passed through unguarded because everywhere else in this package the cluster's answer is
 *   the answer — but this is the one case where a green plan and the cluster disagree, and the
 *   object left standing is the one carrying the estate's failure mail.
 */
export const ProxmoxNotificationTargetProvider = () =>
  Provider.effect(
    ProxmoxNotificationTarget,
    Effect.succeed(ProxmoxNotificationTarget.Provider.of(targetHandlers)),
  );
