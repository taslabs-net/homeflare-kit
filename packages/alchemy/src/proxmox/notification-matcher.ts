/**
 * `Proxmox.NotificationMatcher` — which notifications a PVE cluster sends to which targets.
 *
 * ★ THE HALF OF THE NOTIFICATION SYSTEM notification-target.ts LEAVES OPEN. A target is where a
 *   message CAN go; a matcher decides whether it DOES. A cluster ships one, `default-matcher`,
 *   routing everything to `mail-to-root`, and a target no matcher names receives nothing — so a
 *   declared webhook with no matcher is a delivery path that is never used, and looks finished.
 *
 * ★ ADOPTING THE BUILT-IN AS IT IS: declare what it holds and nothing more. MEASURED on PVE
 *   9.2.11 (2026-09-22, `pvesh get /cluster/notifications/matchers/default-matcher`): mode `all`,
 *   one target `mail-to-root`, no rules, the comment "Route all notifications to mail-to-root".
 *   ```ts
 *   ProxmoxNotificationMatcher('default-matcher', {
 *     target: cluster, name: 'default-matcher', targets: ['mail-to-root'],
 *   });
 *   ```
 *   That plans `noop` and deploys with no write (notification-matcher.test.ts). Leaving `comment`
 *   out leaves it alone; every rule field is compared — notification-matcher-form.ts says why.
 *
 * ★ WHAT THIS NEEDS, READ OFF THE CLUSTER'S OWN SCHEMA (generated/pve.ts source, 9.2.11):
 *     read      GET matchers/{name}   Mapping.Audit or Mapping.Modify on /mapping/notifications
 *     write     POST, PUT, DELETE     Mapping.Modify on /mapping/notifications
 *   The same pair as `Proxmox.NotificationTarget`, with that file's ⚠️ about granting it on `/`.
 *   ⛔ `Mapping.Use` IS NOT ENOUGH, though the COLLECTION GET accepts it: the per-object read this
 *     family makes lists only Audit and Modify (pve-manager API2/Cluster/Notifications.pm
 *     `get_matcher`, read at HEAD 2026-09-22 — corrected here; PR 95 said Use sufficed).
 *   ⛔ THE OLD HAND CLIENT FOLDED A MISSING READ PRIVILEGE INTO "ABSENT", planning a duplicate
 *     create. The distilled read now catches only NotFound: a refused read fails the plan.
 *     The noop still requires a read lease holding Mapping.Audit.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type {
  NotificationMatcherAttributes,
  NotificationMatcherFields,
} from './notification-matcher-form.ts';
import type { PveRequirements, WithTarget } from './resource-spec.ts';
import { matcherHandlers } from './notification-matcher-lifecycle.ts';

export interface NotificationMatcherProps extends NotificationMatcherFields, WithTarget {}

export interface ProxmoxNotificationMatcher extends Resource<
  'Proxmox.NotificationMatcher',
  NotificationMatcherProps,
  NotificationMatcherAttributes,
  never,
  PveRequirements
> {}

/**
 * ⚠️ NO `defaultRemovalPolicy: 'retain'`, for notification-target.ts's reason: a matcher holds no
 *   data, and a plan line is the only warning a delete gets. On `default-matcher` the delete
 *   REVERTS it to the shipped rule instead — see `origin` on the attributes.
 */
export const ProxmoxNotificationMatcher = Resource<ProxmoxNotificationMatcher>(
  'Proxmox.NotificationMatcher',
);

export const ProxmoxNotificationMatcherProvider = () =>
  Provider.effect(
    ProxmoxNotificationMatcher,
    Effect.succeed(ProxmoxNotificationMatcher.Provider.of(matcherHandlers)),
  );
