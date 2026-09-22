/**
 * The PBS half of the ownership ledger. See `proxmox-ownership.ts` for what a row means.
 *
 * ⚠️ SIX RESOURCES AGAINST 182 PBS WRITE ENDPOINTS. That ratio is the report's point, not an
 *   oversight — `/access` (users, tokens, ACL, TFA, realms) has no family here at all.
 */
import { type Ownership, P, crud, notificationEndpoints } from './proxmox-ownership-shape.ts';

export const PBS_OWNERSHIP: readonly Ownership[] = [
  {
    resource: 'Pbs.Datastore',
    system: 'pbs',
    file: `${P}/pbs-datastore.ts`,
    writes: crud('/config/datastore', '/config/datastore/{name}'),
  },
  {
    resource: 'Pbs.NotificationMatcher',
    system: 'pbs',
    file: `${P}/pbs-notification-matcher.ts`,
    writes: crud('/config/notifications/matchers', '/config/notifications/matchers/{name}'),
  },
  {
    resource: 'Pbs.NotificationTarget',
    system: 'pbs',
    file: `${P}/pbs-notification-target-lifecycle.ts`,
    writes: notificationEndpoints('/config/notifications/endpoints'),
  },
  {
    resource: 'Pbs.PruneJob',
    system: 'pbs',
    file: `${P}/pbs-prune-job.ts`,
    writes: crud('/config/prune', '/config/prune/{id}'),
  },
  {
    resource: 'Pbs.SyncJob',
    system: 'pbs',
    file: `${P}/pbs-sync-job.ts`,
    writes: crud('/config/sync', '/config/sync/{id}'),
  },
  {
    // ⛔ THE ENDPOINT THAT STARTED THIS. `deploy:pbs` adopted ten objects and then failed its one
    //   create with `400: parameter verification failed - comment: value may only be 128
    //   characters long`. The limit is in the vendor schema and in nothing we generate from it.
    resource: 'Pbs.VerifyJob',
    system: 'pbs',
    file: `${P}/pbs-verify-job.ts`,
    writes: crud('/config/verify', '/config/verify/{id}'),
  },
];
