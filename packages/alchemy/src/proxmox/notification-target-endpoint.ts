/**
 * `Proxmox.NotificationTarget`'s eight vendor endpoints — one create and one update per family.
 *
 * ⛔ PVE REGISTERS ONE PATH PER TYPE, NOT A `{type}` PARAMETER, AND THE FOUR SCHEMAS DIFFER IN
 *   WHAT THEY REQUIRE: gotify wants `server` and `token`, smtp `server` and `from-address`,
 *   webhook `url` and `method`, sendmail nothing but its name. One key for all four would enforce
 *   gotify's rules on a sendmail target and let three families through unchecked, which is why
 *   `PveSpec['endpoint']` admits a function of props.
 *
 * ⛔ THE STRINGS ARE LITERALS AND MUST STAY LITERALS. `codegen/constraints.ts` finds the endpoints
 *   to table by SCANNING THIS PACKAGE'S TEXT, so `` `pve:POST …/${props.type}` `` would be tabled
 *   by nothing and `constraintsFor` would throw on the first deploy that reached it.
 *
 * ⚠️ GOTIFY'S CREATE CAN NEVER SATISFY ITS OWN TABLE, AND THAT IS THE TRUTH RATHER THAN A BUG
 *   HERE. `token` is required by PVE and is a write-only secret, so it is not a prop — props are
 *   persisted to the state store unencrypted (the third ⛔ in notification-target.ts). A gotify
 *   target is created out of band and then DECLARED, which is an adopt followed by updates; the
 *   shared guard only demands the create form's required parameters when a create is really about
 *   to happen (`resource-guard.ts`), so declaring an existing gotify target still plans clean and
 *   asking to CREATE one is refused at plan time with `token: required` instead of by a 400.
 */
import type { NotificationTargetProps } from './notification-target.ts';
import type { EndpointPair } from './resource-spec.ts';

const ENDPOINTS: Readonly<Record<NotificationTargetProps['type'], EndpointPair>> = {
  gotify: {
    create: 'pve:POST /cluster/notifications/endpoints/gotify',
    update: 'pve:PUT /cluster/notifications/endpoints/gotify/{name}',
  },
  sendmail: {
    create: 'pve:POST /cluster/notifications/endpoints/sendmail',
    update: 'pve:PUT /cluster/notifications/endpoints/sendmail/{name}',
  },
  smtp: {
    create: 'pve:POST /cluster/notifications/endpoints/smtp',
    update: 'pve:PUT /cluster/notifications/endpoints/smtp/{name}',
  },
  webhook: {
    create: 'pve:POST /cluster/notifications/endpoints/webhook',
    update: 'pve:PUT /cluster/notifications/endpoints/webhook/{name}',
  },
};

/** The pair this declaration writes. ⚠️ `type` is identity here, so it never changes under a row. */
export const targetEndpoint = (props: NotificationTargetProps): EndpointPair =>
  ENDPOINTS[props.type];
