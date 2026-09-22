/**
 * `Pbs.NotificationTarget` — where a Proxmox Backup Server sends a notification: a `webhook`, or
 * mail through `sendmail` or `smtp`.
 *
 * ★ THE WEBHOOK IS THE POINT. A failed verify, sync or garbage collection reaches a human through a
 *   target a matcher names (pbs-notification-matcher.ts). Out of the box that is `mail-to-root`,
 *   one mailbox on one host; a webhook can post an Alertmanager alert instead, and then the failure
 *   pages like everything else. docs/pbs-alertmanager-body.md has the body template.
 *
 * ⛔ SECRETS ARE DECLARED BY THE NAME OF AN ENVIRONMENT VARIABLE, NEVER BY VALUE, and NO VALUE EVER
 *   REACHES STATE — not as a prop, not as an attribute. write-only.ts has the whole argument; the
 *   short form: Alchemy stores props and attributes unencrypted, so `secret`, `password` and any
 *   header holding a credential take `{ fromEnv: 'NAME' }`, read by the deploying process at call
 *   time. What the store keeps is presence (names) and digests, and the plan diffs on those.
 *   ★ THIS IS WHERE THE PBS FAMILY PARTS FROM notification-target.ts (PVE), which refuses every
 *     secret and so cannot create a signed webhook at all.
 *
 * ⛔ THE PER-OBJECT PATH CARRIES THE FAMILY: `config/notifications/endpoints/{type}/{name}`. `type`
 *   is identity, and changing it or `name` plans a REPLACE here — `diff` compares them with the
 *   recorded props. `/config/notifications/targets` is a read-only union view, as on PVE.
 *
 * ⚠️ A BUILT-IN TARGET REVERTS ON DELETE instead of disappearing (`origin: builtin`, measured on
 *   PBS 4.2 for `mail-to-root`), and PBS reports success either way — notification-target.ts has
 *   the consequence. Read `origin` before declaring a name you did not create.
 *
 * ★ WHAT THIS NEEDS (generated/pbs.ts source): Sys.Audit on /system/notifications to read,
 *   Sys.Modify there to write. A datastore-scoped credential reads every target as absent.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { handlers } from './pbs-notification-target-lifecycle.ts';
import type { PveRequirements, WithPbsTarget } from './resource.ts';
import type { FromEnv } from './write-only.ts';

export type PbsNotificationTargetType = 'sendmail' | 'smtp' | 'webhook';

/**
 * ⚠️ PBS'S OWN KEY NAMES, DASHES INCLUDED, for the reason backup-job.ts gives. A field outside its
 *   family (a `url` on a sendmail target) is refused at plan by name, not sent for a 400.
 * ⚠️ AN UNDECLARED FIELD IS NEITHER SENT NOR COMPARED; `''` or `[]` (or `{}`) CLEARS ONE.
 */
export interface PbsNotificationTargetProps extends WithPbsTarget {
  /** ⛔ IDENTITY: it picks the family and the URL. Changing it is a replace. */
  type: PbsNotificationTargetType;
  /** Unique across ALL families on the host: a webhook cannot be called `mail-to-root`. */
  name: string;
  comment?: string;
  /** Configured but not delivering. Always sent and always compared. */
  disable?: boolean;
  /** sendmail, smtp: recipient addresses. Order is not meaning. */
  mailto?: readonly string[];
  /** sendmail, smtp: PBS users whose configured address receives the mail. */
  'mailto-user'?: readonly string[];
  /** smtp: required. sendmail: optional. */
  'from-address'?: string;
  author?: string;
  /** smtp: the relay host. Required. */
  server?: string;
  /** smtp. Unset lets PBS pick from `mode`. */
  port?: number;
  /** smtp. PBS's default is `tls`. */
  mode?: 'insecure' | 'starttls' | 'tls';
  /** smtp. */
  username?: string;
  /** smtp: ⛔ WRITE-ONLY. The server never returns it; the plan compares its seal. */
  password?: FromEnv;
  /** webhook: required. Supports templating: `{{ secrets.<name> }}` keeps a token out of it. */
  url?: string;
  /** webhook: required. */
  method?: 'get' | 'post' | 'put';
  /**
   * webhook: header name → template text, or `{ fromEnv }` for a value that is itself a secret.
   * ⚠️ PLAIN VALUES ARE PROPS, AND PROPS ARE STORED: `Content-Type` is fine, a token is not. Put a
   *   credential in `secret` and write `'Bearer {{ secrets.token }}'` here instead.
   */
  header?: Readonly<Record<string, FromEnv | string>>;
  /**
   * webhook: the body TEMPLATE, as text. ★ Declared DECODED — the wire is base64, and this family
   *   encodes on write and decodes on read, so a plan shows a readable diff.
   */
  body?: string;
  /** webhook: ⛔ WRITE-ONLY. Name → variable. Referenced as `{{ secrets.<name> }}`. */
  secret?: Readonly<Record<string, FromEnv>>;
}

/** ⛔ NO VALUE OF A SECRET, PASSWORD OR HEADER — names and digests only. */
export interface PbsNotificationTargetAttributes {
  name: string;
  type: PbsNotificationTargetType;
  /** `builtin`, `modified-builtin`, `user-created` — reported, never compared. */
  origin: string;
  comment: string;
  disable: boolean;
  mailto: string;
  'mailto-user': string;
  'from-address': string;
  author: string;
  server: string;
  /** 0 means PBS holds no port. */
  port: number;
  mode: string;
  username: string;
  url: string;
  method: string;
  /** The decoded body template. */
  body: string;
  /** Header NAMES, sorted — presence. */
  header: string;
  /** scrypt digest of the live header pairs, fixed salt per target. */
  headerDigest: string;
  /** Secret NAMES, sorted — all PBS will say. */
  secret: string;
  /**
   * Seal of the secret values and password THIS PROVIDER LAST WROTE; `''` if it never wrote them
   * (an adoption). ⚠️ `''` makes those values presence-only until the first write that carries them.
   */
  sealed: string;
}

export interface PbsNotificationTarget extends Resource<
  'Pbs.NotificationTarget',
  PbsNotificationTargetProps,
  PbsNotificationTargetAttributes,
  never,
  PveRequirements
> {}

export const PbsNotificationTarget = Resource<PbsNotificationTarget>('Pbs.NotificationTarget');

/**
 * ⛔ `Provider.of` STAYS HERE, for resource.ts's reason: it is the one place the handlers are
 *   checked against the concrete resource types, so the lifecycle file cannot drift from them.
 */
export const PbsNotificationTargetProvider = () =>
  Provider.effect(
    PbsNotificationTarget,
    Effect.succeed(PbsNotificationTarget.Provider.of(handlers)),
  );
