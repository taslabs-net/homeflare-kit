/**
 * Which PHYSICAL cluster answers — the kube-system Namespace's `metadata.uid`.
 *
 * ★ WHY THE UID. It is public, assigned once at cluster creation and stable across CA and
 *   admin-cert rotation (a CA fingerprint is not: rotation would read as "a different cluster").
 *   Every cluster has the namespace, and the admin kubeconfig can read it.
 * ★ The GET goes through alchemy's own `readObject` (`Kubernetes/internal/client.ts`, reached
 *   through the package's `./*` export) so TLS, CA and client-cert handling stay upstream's.
 */
import type { ClusterTransport } from 'alchemy/Kubernetes/ClusterAdapter';
import { readObject } from 'alchemy/Kubernetes/internal/client';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import {
  TalosClusterIdentityMismatch,
  TalosClusterIdentityTimeout,
  TalosClusterIdentityUnreadable,
} from './cluster-adapter-errors.ts';

const KUBE_SYSTEM = { apiVersion: 'v1', kind: 'Namespace', name: 'kube-system' } as const;

/**
 * ⛔ upstream `readObject` (`internal/client.ts`) sets no request timeout, so a silent apiserver
 *   would hang connect and every plan. Bounded here; the failure is typed and closed.
 * ⛔ SHORTER THAN `CONNECT_TIMEOUT` (10 s, cluster-transport.ts): the outer deadline wraps the vault
 *   read AND this uid GET together, so an equal inner deadline could never fire first and
 *   `TalosClusterIdentityTimeout` was unreachable through `connectTalosOpenBao` (red team, PR 355).
 *   A silent apiserver now fails with the identity timeout while a slow `bao` still gets the full
 *   outer budget.
 */
export const UID_READ_TIMEOUT = Duration.seconds(5);

/** The cluster's kube-system uid. Request failures propagate: nothing here fails open. */
export const readClusterUid = (
  cluster: string,
  transport: ClusterTransport,
  timeout: Duration.Duration = UID_READ_TIMEOUT,
) =>
  readObject({ object: KUBE_SYSTEM, transport }).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(
          new TalosClusterIdentityTimeout({ cluster, seconds: Duration.toSeconds(timeout) }),
        ),
    }),
    Effect.flatMap((body) => {
      const uid = (body as { metadata?: { uid?: unknown } } | undefined)?.metadata?.uid;
      return typeof uid === 'string' && uid !== ''
        ? Effect.succeed(uid)
        : Effect.fail(new TalosClusterIdentityUnreadable({ cluster }));
    }),
  );

/** Succeeds only when the answering cluster is the one `expected` names. */
export const assertClusterUid = (cluster: string, expected: string, transport: ClusterTransport) =>
  readClusterUid(cluster, transport).pipe(
    Effect.flatMap((got) =>
      got === expected
        ? Effect.void
        : Effect.fail(new TalosClusterIdentityMismatch({ cluster, expected, got })),
    ),
  );
