/**
 * `Ceph.AuthEntity` (K-A4) — a Ceph client auth entity (`client.k8s-*`), minted over the ssh
 * mon-command transport and stored only in OpenBao. Design: docs/plans/2026-09-26-ceph-mon-
 * transport.md, "`Ceph.AuthEntity` (K-A4)"; the loop itself lives in ceph-auth-reconcile.ts, the
 * transport in ceph-transport.ts, the allowlist in ceph-argv.ts.
 *
 * ⛔ `read` AND `diff` NEVER SSH. "A plan never elevates" (../linux/sudo-runner.ts's own header
 *   makes the same rule for the file family): this family's props/state comparison is the whole
 *   of `diff`, and `read` hands back exactly the attributes state already holds. Live drift is
 *   caught only at `reconcile` (which does elevate, on the admin lane) and by the post-deploy
 *   operator check — this family cannot prove live convergence at plan time, and says so rather
 *   than pretending an unprivileged probe exists where none does.
 * ⛔ `delete` IS REFUSED UNCONDITIONALLY. `defaultRemovalPolicy: 'retain'` keeps Alchemy from ever
 *   calling it on an ordinary `destroy`, and the handler itself refuses too — belt and suspenders
 *   with ceph-argv.ts's own refusal of the `auth del` shape, so there is no path, `--adopt` or a
 *   resource-level removal-policy override included, that ever reaches it (D3).
 * ⛔ NEVER ADOPTED. See ceph-auth-reconcile.ts's header for why the generic `refuseTakeover` is not
 *   used here.
 * ⛔ ROWS ARE CREATES THROUGH THE FIRST-CREATE GATE, NO `adopt()` — `list` answers empty, the same
 *   as every Ceph family in this kit (ceph-pool.ts's header has the reason a non-empty list would
 *   invite exactly the takeover this family refuses).
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type { CephAuthEntityAttributes, CephAuthEntityProps } from './ceph-auth-form.ts';
import { planCephAuthEntity } from './ceph-auth-form.ts';
import { reconcileCephAuthEntity } from './ceph-auth-reconcile.ts';

export type { CephAuthEntityAttributes, CephAuthEntityProps } from './ceph-auth-form.ts';
export type { CephCaps } from './ceph-auth-parse.ts';

export interface CephAuthEntity extends Resource<
  'Ceph.AuthEntity',
  CephAuthEntityProps,
  CephAuthEntityAttributes,
  never,
  HttpClient.HttpClient
> {}

/** ★ `retain` — the delete handler below refuses regardless, but this stops Alchemy calling it. */
export const CephAuthEntity = Resource<CephAuthEntity>('Ceph.AuthEntity', {
  defaultRemovalPolicy: 'retain',
});

const refusedDelete = (entity: string): Error =>
  new Error(
    `Ceph.AuthEntity ${entity}: 'ceph auth del' is refused entirely — lockout safety, never ` +
      'auto-delete (D3). Nothing was sent to any mon. If the entity truly must go, remove it by ' +
      'hand, deliberately, along with its OpenBao key — this family will never do it for you.',
  );

export const CephAuthEntityProvider = () =>
  Provider.effect(
    CephAuthEntity,
    Effect.succeed(
      CephAuthEntity.Provider.of({
        list: () => Effect.succeed([]),

        /** State only — see the header. Never `Unowned`: this family is never adopted. */
        read: ({ output }) => Effect.succeed(output),

        /** State only — see the header. `output === undefined` lets reconcile decide (a create). */
        diff: ({ news, output }) =>
          Effect.succeed(isResolved(news) ? planCephAuthEntity(news, output) : undefined),

        reconcile: ({ news, output }) => reconcileCephAuthEntity(news, output, {}),

        delete: ({ output }) => Effect.die(refusedDelete(output.entity)),
      }),
    ),
  );
