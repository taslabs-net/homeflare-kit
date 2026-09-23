/**
 * `Pbs.NotificationTarget`'s six vendor endpoints — one create and one update per family.
 *
 * 🔴 THIS FAMILY WAS THE ONE THE 2026-09-22 SWEEP NEARLY MISSED, and it carries the very
 *   parameter the incident was about: `comment` is `maxLength: 128` with a no-control-characters
 *   pattern on all three PBS creates, exactly as it is on `POST /config/verify`. A 129-character
 *   comment on a notification target would have failed the same way, half a deploy in, on the
 *   family whose whole purpose is to make failures visible.
 *
 * ⛔ PBS REGISTERS ONE PATH PER TYPE, NOT A `{type}` PARAMETER, and the three schemas differ:
 *   smtp requires `server` and `from-address`, webhook `url` and `method`, sendmail nothing but
 *   its name. One key would enforce one family's rules on all three.
 * ⛔ THE STRINGS MUST STAY LITERALS. `codegen/constraints.ts` finds the endpoints to table by
 *   SCANNING THIS PACKAGE'S TEXT, so a key built from `props.type` would be tabled by nothing.
 *
 * ⚠️ NO GOTIFY KEY, BECAUSE THIS RESOURCE HAS NO GOTIFY TYPE. `PbsNotificationTargetType` is
 *   sendmail | smtp | webhook; PBS 4.2 does publish a gotify endpoint, and nothing here writes to
 *   it. ⛔ `scripts/proxmox-ownership-pbs.ts` says otherwise — it claims all four families
 *   through the shared `notificationEndpoints` helper — so `docs/api-coverage.md` credits this
 *   resource with twelve write endpoints where it really makes nine. That is an overclaim in the
 *   hand-written ownership ledger, recorded here rather than fixed in passing: correcting it
 *   regenerates a report built from a DIFFERENT (older, 9.2.4) schema manifest, which is its own
 *   change with its own diff.
 */
import type { PbsNotificationTargetProps } from './pbs-notification-target.ts';
import type { EndpointPair } from './resource-spec.ts';

const ENDPOINTS: Readonly<Record<PbsNotificationTargetProps['type'], EndpointPair>> = {
  sendmail: {
    create: 'pbs:POST /config/notifications/endpoints/sendmail',
    update: 'pbs:PUT /config/notifications/endpoints/sendmail/{name}',
  },
  smtp: {
    create: 'pbs:POST /config/notifications/endpoints/smtp',
    update: 'pbs:PUT /config/notifications/endpoints/smtp/{name}',
  },
  webhook: {
    create: 'pbs:POST /config/notifications/endpoints/webhook',
    update: 'pbs:PUT /config/notifications/endpoints/webhook/{name}',
  },
};

/** The pair this declaration writes. ⚠️ `type` is identity here — changing it is a replace. */
export const pbsTargetEndpoint = (props: PbsNotificationTargetProps): EndpointPair =>
  ENDPOINTS[props.type];
