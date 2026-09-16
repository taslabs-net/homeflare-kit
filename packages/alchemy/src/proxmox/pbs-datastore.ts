/**
 * `Pbs.Datastore` — one section of Proxmox Backup Server's `datastore.cfg`, declared.
 *
 * ★ PBS IS A SIBLING OF PVE, NOT A PART OF IT. The estate runs both — PVE carries a storage of
 *   `type: pbs` — so declaring the datastore turns `Proxmox.Storage`'s `locator.datastore` from a
 *   string nothing checks into a reference Alchemy can order, as `Proxmox.SdnVnet` did for a bridge.
 *
 * ⛔ DIFFERENT HOST, DIFFERENT REALM, DIFFERENT AUTH HEADER. MEASURED 2026-09-13, strict TLS, no
 *   `-k` anywhere: `GET https://pbs.example.com:8007/api2/json/ping` answers 200
 *   `{"data":{"pong":true}}` against a Let's Encrypt certificate for CN=pbs.example.com;
 *   `/version` and `/config/datastore` answer 401 "authentication failed";
 *   `pbs.mgmt.example.com:8007` answers 401 and its certificate verifies too; and
 *   `/access/domains` lists the realms `pbs`, `pam` and an openid realm `Schenanigans`. So the
 *   prefix, the `{"data": …}` envelope and the strict-TLS story are PVE's exactly — and only the
 *   credential differs. There is no `pve` realm here; a PVE token cannot authenticate at all.
 *   The header differs too, which is why `pve()` exists rather than `pve()` being reused — see the
 *   ⛔ on `pbsAuthorization` in pbs-datastore-form.ts.
 *
 * ⛔ THERE IS NO OPENBAO MOUNT FOR PBS TODAY, SO NOTHING HERE CAN DEPLOY YET. `PbsTarget.mount` is
 *   a parameter for the reason `PveTarget.mount` is — the provider must be able to leave this
 *   estate — but the estate has nothing to put in it. MEASURED: under the `claude-code` approle,
 *   `bao token capabilities` answers `deny` for `proxmox-tb4/creds/{read,provision}`,
 *   `proxmox-ops/creds/read` and every `…pbs…` path tried, and `sys/mounts` is 403 — so I could
 *   not enumerate the mounts to PROVE a PBS one is absent. That it is absent is the brief's
 *   statement, not my measurement.
 *   ★ WHAT THE MOUNT MUST VEND, so `mint()` is reused unchanged: `bao read -format=json
 *     <mount>/creds/<role>` answering `{"data":{"token_id":…,"secret":…}}`, where `token_id` is a
 *     PBS token id `user@realm!tokenname` — `hf-read@pbs!…` and `hf-provision@pbs!…`. Same short,
 *     non-renewable lease contract as `proxmox-tb4`.
 *   ⚠️ PBS HAS NO DYNAMIC-SECRETS PLUGIN OF ITS OWN — OpenBao's Proxmox support is a PVE thing — so
 *     the mount is a small custom vendor against `POST /access/users/{id}/token/{name}`. Say which
 *     mount and role you needed rather than reaching for the read-only `monitoring@pbs` token on
 *     the kv shelf: widening that would delete the outer lock for every reader of the shelf.
 *
 * ⛔ A DATASTORE HOLDS THE BACKUPS, SO `retain` IS THE DEFAULT AND `delete` IS FULLY IMPLEMENTED —
 *   the ★ on removal policy in resource.ts has the whole reasoning. A stub returning `Effect.void`
 *   would report a deletion that never happened, and this is the family where that lie costs most.
 *
 * ⚠️ PRIVILEGES, READ OFF THE PUBLISHED SCHEMA RATHER THAN OFF THIS HOST:
 *     read   GET    config/datastore/{name}   Datastore.Audit    on /datastore/{name}
 *     create POST   config/datastore          Datastore.Allocate on /datastore
 *     update PUT    config/datastore/{name}   Datastore.Modify   on /datastore/{name}
 *     delete DELETE config/datastore/{name}   Datastore.Allocate on /datastore/{name}
 *   Built-in `DatastoreAdmin` at `/datastore` covers all four; `DatastoreAudit` covers the read
 *   lane alone, which is what the `read` role should hold.
 *
 * ⛔ NO SECRET IS A PROP OR AN ATTRIBUTE, AND THIS FAMILY IS CLEAN BY CONSTRUCTION: a datastore
 *   section holds no password, token or key — encryption keys belong to the backup CLIENT. Every
 *   field below is a name, a path, a schedule, a count or a policy string, all of which are safe in
 *   a state store Alchemy writes UNENCRYPTED and this estate dumps to CT100 nightly.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { pve } from './client.ts';
import {
  type PbsDatastoreAttributes,
  type PbsTarget,
  createForm,
  matches,
  object,
  readOne,
  updateForm,
} from './pbs-datastore-form.ts';
import { guardBackend, guardPath, settle } from './pbs-datastore-guard.ts';
import type { PveRequirements } from './resource.ts';

export type { PbsDatastoreAttributes, PbsTarget };

/**
 * ⚠️ PBS'S OWN KEY NAMES, HYPHENS INCLUDED — backup-job.ts's rule: the form is then a copy rather
 *   than a translation table, and a translation table is one more place for a key to be renamed and
 *   silently never sent.
 * ⚠️ AN UNDECLARED FIELD IS NEITHER SENT NOR COMPARED — storage.ts's rule, not sdn-vnet.ts's, and
 *   for a retention policy the choice is not close: see the ⛔ on `updateForm`.
 */
export interface PbsDatastoreProps {
  target: PbsTarget;
  /** PBS's primary key. Create-only: there is no rename, and a new name is a new datastore. */
  name: string;
  /**
   * Absolute path to the datastore directory.
   *
   * ⛔ CREATE-ONLY, AND THE ONE FIELD THIS FILE REFUSES TO LET DRIFT QUIETLY. PBS's update endpoint
   *   does not accept `path`, so comparing it in `matches` could only plan an update no PUT can
   *   apply — the forever-diff storage.ts avoids by letting its create-only `type` plan as NOOP.
   *   Here a silent noop is the wrong trade: the operator would read a green plan while PBS kept
   *   writing backups to the old directory. So `diff` and `reconcile` compare it themselves and DIE
   *   with both values named. A path change is remove-and-redeclare, deliberately.
   */
  path: string;
  comment?: string;
  /** Calendar event for garbage collection, e.g. `daily` or `sat 18:15`. */
  'gc-schedule'?: string;
  /** Calendar event for the built-in prune job. Retention itself is the `keep-*` fields below. */
  'prune-schedule'?: string;
  /** ⚠️ PBS's minimum is 1 for every keep-*. A declared `0` is refused, and does not mean "off". */
  'keep-last'?: number;
  'keep-hourly'?: number;
  'keep-daily'?: number;
  'keep-weekly'?: number;
  'keep-monthly'?: number;
  'keep-yearly'?: number;
  /**
   * Legacy notification routing: `gc=<never|always|error>`, and the same for `verify` and `sync`.
   * ⚠️ PBS 3.2+ picks between this and the notification system with `notification-mode`, which is
   *   NOT declarable here: flipping a live datastore between the two silently changes who hears
   *   about a failed verify, and silence is the failure mode that costs most (notification-target.ts).
   */
  notify?: string;
  /** PBS user id legacy notifications go to. PBS's schema default is `root@pam`. */
  'notify-user'?: string;
  /** Verify every new backup the moment it completes. PBS's default is false. */
  'verify-new'?: boolean;
  /** Property string: `chunk-order=<none|inode>,sync-level=<none|file|filesystem>`, and more. */
  tuning?: string;
  /**
   * Takes the datastore out of service: `type=<offline|read-only|unmount>`, optional
   * `message=<text>`. PBS's default key is `type`, so the bare `offline` normalises to the same
   * string here and either spelling is safe.
   * ⛔ NEVER DECLARE `type=delete`. PBS sets that itself while destroying a datastore's contents.
   * ⚠️ A `message` CONTAINING A COMMA BREAKS THE COMPARISON, not the write: `propertyString` splits
   *   on commas and does not honour PBS's quoting, so the two sides never compare equal and the
   *   plan asks for the same update forever. Keep the message comma-free.
   */
  'maintenance-mode'?: string;
  /**
   * ⛔ CREATE-ONLY, LIKE `path`, AND FOR A SHARPER REASON. MEASURED on the live 4.2 host:
   *   `datastore create --help` offers `--backend`, `datastore update --help` does NOT, and
   *   `backend` is absent from update's `--delete` enum. PBS will not move a datastore between
   *   local disk and object storage, ever.
   * ★ IT IS A PROP AT ALL BECAUSE THE ESTATE HAS ONE. `r2-offsite` holds
   *   `type=s3,client=cloudflare-r2,bucket=homeflare-pbs`. Leaving it undeclared would still plan
   *   noop — undeclared is unmanaged here — but the declaration would then describe a LOCAL
   *   datastore, and anyone recreating from it would get exactly that: an empty directory on the
   *   mini's disk where the offsite copy used to be, behind a green plan the whole way.
   * ⚠️ A property string. Compared canonically, so key order is never a diff.
   */
  backend?: string;
  /** ⚠️ S3 request counters reset on this calendar event. Mutable; in update's `--delete` enum. */
  'counter-reset-schedule'?: string;
  /**
   * ⚠️ S3 request-count thresholds that raise a notification, e.g. `s3-put=700000,s3-get=200000`.
   *   A property string, compared canonically. Mutable.
   */
  'notification-thresholds'?: string;
}

export interface PbsDatastore extends Resource<
  'Pbs.Datastore',
  PbsDatastoreProps,
  PbsDatastoreAttributes,
  never,
  PveRequirements
> {}

/** ★ `retain` by default — a datastore holds the backups. See the ★ in resource.ts. */
export const PbsDatastore = Resource<PbsDatastore>('Pbs.Datastore', {
  defaultRemovalPolicy: 'retain',
});

export const PbsDatastoreProvider = () =>
  Provider.effect(
    PbsDatastore,
    Effect.succeed(
      PbsDatastore.Provider.of({
        /**
         * ⛔ EMPTY, AND HERE IT GUARDS THE ESTATE'S BACKUPS. `GET /config/datastore` returns every
         *   datastore on the host, the one PVE's `type: pbs` storage writes into included. See
         *   `pveHandlers` in resource.ts for why adoption stays an explicit act.
         */
        list: () => Effect.succeed([]),
        read: ({ olds }) => readOne(olds),
        /**
         * ⚠️ `isResolved` IS THE NARROWING, resource.ts's reason: at plan time a prop can still be an
         *   unresolved Output, and comparing a placeholder to a live value reports a phantom update.
         * ⛔ `guardPath` IS A DELIBERATE DEPARTURE FROM storage.ts, which lets its create-only field
         *   plan as noop. Dying fails `alchemy plan` with both paths named — see the ⛔ on the prop.
         */
        diff: ({ news, output }) =>
          Effect.gen(function* () {
            if (output === undefined || !isResolved(news)) return undefined;
            const live = yield* readOne(news);
            // ⚠️ `update`, not `create` — Alchemy's Diff admits only noop/update/replace, and an
            //   object Alchemy has state for but PBS does not is drift for reconcile to repair.
            if (live === undefined) return { action: 'update' } as const;
            yield* guardPath(live, news);
            yield* guardBackend(live, news);
            return matches(live, news)
              ? ({ action: 'noop' } as const)
              : ({ action: 'update' } as const);
          }),
        /**
         * ⚠️ NOT THE FACTORY'S reconcile: it reads back ONCE, immediately — see the ⛔ on `settle`.
         * ⛔ `guardPath` RUNS HERE TOO, AND THAT IS NOT BELT-AND-BRACES — see the ⛔ on it.
         * ⛔ THE `matches` GUARD BEFORE THE PUT IS resource.ts's, AND IT IS WHY ADOPTION IS FREE.
         */
        reconcile: Effect.fn(function* ({ news }) {
          const live = yield* readOne(news);
          let upid: string | undefined;
          if (live === undefined) {
            upid = yield* pve<string>(
              news.target,
              'provision',
              'POST',
              'config/datastore',
              createForm(news),
            );
          } else {
            yield* guardPath(live, news);
            yield* guardBackend(live, news);
            // ⚠️ An empty form is not a write — resource.ts skips one for the same reason.
            const form = updateForm(news);
            if (!matches(live, news) && Object.keys(form).length > 0) {
              yield* pve(news.target, 'provision', 'PUT', object(news), form);
            }
          }
          const after = yield* settle(
            readOne(news),
            (row) => row !== undefined && matches(row, news),
          );
          if (after === undefined || !matches(after, news)) {
            /**
             * ⛔ REFUSE RATHER THAN RETURN THE PROPS AS THOUGH THEY LANDED — resource.ts's rule.
             *   A create answers with a task id, so "no error" is not evidence of a datastore.
             */
            return yield* Effect.die(
              new Error(
                `${object(news)}: the write returned no error but the datastore still does not ` +
                  `match the declaration after 120s. PBS answered with task ${upid ?? '(none)'} ` +
                  '-- read it with `proxmox-backup-manager task log <upid>`. A slow disk is a ' +
                  'plausible cause (see `settle`); a create over an existing chunk store is not, ' +
                  'because PBS refuses that outright rather than timing out.',
              ),
            );
          }
          return after;
        }),
        /**
         * ⛔ FULLY IMPLEMENTED, NEVER A STUB, and it only ever runs on an explicit
         *   `.pipe(RemovalPolicy.destroy())` because this family defaults to `retain`.
         * ⛔ NO `destroy-data`. PBS's DELETE drops the section from `datastore.cfg` and leaves every
         *   chunk and snapshot on disk; `destroy-data=1` erases the contents. It is not a prop and
         *   not a flag here, so this provider can un-declare a datastore and can never erase one.
         *   ⚠️ IT IS STILL A ONE-WAY DOOR FOR A DECLARATION: re-adding a datastore over an existing
         *     chunk store needs `reuse-datastore`, which is deliberately not declarable — see the
         *     ⚠️ on `createForm`. Re-adopt with `proxmox-backup-manager datastore create …`.
         * ⚠️ NO `keep-job-configs` EITHER, SO THE JOBS GO TOO: PBS defaults it false and removes the
         *   verify, sync and prune jobs referencing this datastore — objects nothing here declares.
         *   PBS's default stands, so the blast radius is what a human clicking Remove would get.
         * ⚠️ AND THE REFUSAL CAN ARRIVE AFTER THE RESPONSE: the delete forks a worker too, so a store
         *   held open by a running backup can fail once the call has already returned 200.
         */
        delete: Effect.fn(function* ({ olds }) {
          yield* pve<string>(olds.target, 'provision', 'DELETE', object(olds));
          const left = yield* settle(readOne(olds), (row) => row === undefined);
          if (left !== undefined) {
            return yield* Effect.die(
              new Error(
                `${object(olds)}: the DELETE returned no error but the datastore is still in ` +
                  'datastore.cfg after 120s. Either a backup, verify or GC task still holds it, ' +
                  'or the provision role lacks Datastore.Allocate on /datastore/' +
                  `${olds.name}. Read the task log with \`proxmox-backup-manager task log <upid>\`.`,
              ),
            );
          }
        }),
      }),
    ),
  );
