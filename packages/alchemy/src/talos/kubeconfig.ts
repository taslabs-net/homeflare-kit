/**
 * `Talos.Kubeconfig` — fetch admin kubeconfig so `Kubernetes.*` workloads can connect.
 *
 * ★ REASONED FROM talosctl kubeconfig (Talos v1.13 CLI reference): writes a kubeconfig file;
 *   `--merge=false` keeps it isolated; `-f/--force` overwrites an existing file.
 *
 * ⛔ THE KUBECONFIG FILE CONTAINS A CLIENT CERTIFICATE — IT MUST NOT BE AN ATTRIBUTE. Alchemy
 *   persists attributes unencrypted. This resource persists ONLY public metadata + fingerprints,
 *   never the file's own bytes.
 *
 * ⛔ LANDS IN OPENBAO, NOT A HOST `runtimePath` (K-talos-first-boot, 2026-09-26). The shipped shape
 *   wrote a cluster-admin kubeconfig to un-vaulted host disk and never removed it — the exact class
 *   of exposure `talos/credentials.ts`'s own header exists to prevent — and its own `read` depended
 *   on that file's continued presence, so verifying from any other host planned `update` forever
 *   (docs/plans/2026-09-26-talos-secrets-flow.md's "Measured today" section). Fixed:
 *     - CREATE (`output === undefined`) runs `talosctl kubeconfig` into a throwaway, unguessable
 *       temp path (this file's own `reservedTempPath`), reads it back, and writes its bytes into
 *       OpenBao at `target.mount`/`kubeconfigKey` via stdin (`credentials-write.ts`'s
 *       `writeKvValue` — ⛔ never argv) — never to any path a caller could depend on.
 *     - ⛔ WRITTEN ONCE, NOT RE-MINTED EVERY DEPLOY. `talosctl kubeconfig` always issues a FRESH
 *       admin client certificate; re-running it every reconcile would rotate credentials for no
 *       reason and violate O1's write-once-at-bring-up grant on this one key
 *       (docs/plans/2026-09-26-talos-secrets-flow.md, O1). Once `output` is defined, reconcile only
 *       reads the vault copy back to confirm it — the same "once" shape `talos-bootstrap.ts` uses
 *       for a boolean, here for a value.
 *     - The persisted `connection` no longer carries a host path — a consumer materializes its own
 *       temp file via `credentials.ts`'s `mintKubeconfig`, the same pattern `mintTalosconfig`
 *       already established. Wiring `Kubernetes.ClusterAdapter` to call it is separate, later work
 *       (named, not built, in the secrets-flow doc); this only makes the vault-backed read+mint
 *       step exist for it to call.
 */
import { chmodSync } from 'node:fs';
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import type { Connection } from 'alchemy/Kubernetes/Connection';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { DEFAULT_KUBECONFIG_KEY, mintTalosconfig, readKvValue } from './credentials.ts';
import { reservedTempPath, writeKvValue } from './credentials-write.ts';
import type { TalosRequirements, WithTarget } from './resource.ts';
import { talosctl } from './talosctl.ts';
import { kubeconfigMetadata, sha256 } from './values.ts';

export interface KubeconfigProps extends WithTarget {
  /** Node that serves `talosctl kubeconfig`. */
  node: string;
  /** Context name inside the generated kubeconfig — not secret. */
  context: string;
  /** OpenBao KV path under `target.mount` for the written kubeconfig. Default `'kubeconfig'`. */
  kubeconfigKey?: string;
  after?: readonly unknown[];
}

export interface KubeconfigAttributes {
  context: string;
  endpoint: string;
  certificateAuthorityFingerprint: string;
  clientCertificateFingerprint: string;
  /** Digest of endpoint+context+fingerprints — detects credential rotation without storing PEM. */
  credentialGeneration: string;
  /**
   * Serializable `Kubernetes.Connection` for downstream workloads.
   *
   * ★ auth.kind `kubeconfig` is the stock ClusterAdapter — provider-roadmap.md names this seam.
   *   `path` is deliberately absent: the content lives in OpenBao, not at a fixed host path. A
   *   consumer materializes its own scoped temp file via `credentials.ts`'s `mintKubeconfig`.
   */
  connection: Connection;
}

export interface TalosKubeconfig extends Resource<
  'Talos.Kubeconfig',
  KubeconfigProps,
  KubeconfigAttributes,
  never,
  TalosRequirements
> {}

export const TalosKubeconfig = Resource<TalosKubeconfig>('Talos.Kubeconfig');

const generation = (meta: {
  endpoint: string;
  caFingerprint: string;
  clientFingerprint: string;
  context: string;
}) => sha256(`${meta.context}\n${meta.endpoint}\n${meta.caFingerprint}\n${meta.clientFingerprint}`);

const toConnection = (props: KubeconfigProps): Connection => ({
  auth: { context: props.context, kind: 'kubeconfig' },
});

const emptyAttrs = (props: KubeconfigProps): KubeconfigAttributes => ({
  certificateAuthorityFingerprint: '',
  clientCertificateFingerprint: '',
  connection: toConnection(props),
  context: props.context,
  credentialGeneration: '',
  endpoint: '',
});

const buildAttrs = (raw: string, props: KubeconfigProps): KubeconfigAttributes | undefined => {
  const meta = kubeconfigMetadata(raw, props.context);
  if (meta === undefined) return undefined;
  return {
    certificateAuthorityFingerprint: meta.caFingerprint,
    clientCertificateFingerprint: meta.clientFingerprint,
    connection: toConnection(props),
    context: props.context,
    credentialGeneration: generation({ ...meta, context: props.context }),
    endpoint: meta.endpoint,
  };
};

/**
 * ★ MIRRORS THE PRE-EXISTING FILE-READ TOLERANCE, KEPT RATHER THAN FIXED HERE — the shipped
 *   host-file `read` already treated "nothing there yet" the same as any other read failure
 *   (`Effect.orElseSucceed`); this vault-backed version keeps that same honesty level. Bootstrap's
 *   and ClusterHealth's swallowing fixes are this task's explicit scope; a vault-native
 *   absence-vs-transport-failure probe for Kubeconfig (there is no maintenance-mode-style signal
 *   for "is this KV key written yet") is real follow-up work, not a regression introduced here.
 */
const readVaultMeta = (props: KubeconfigProps, key: string) =>
  readKvValue(props.target.mount, key, ['kubeconfig', 'config']).pipe(
    Effect.map((raw) => buildAttrs(raw, props)),
    Effect.orElseSucceed(() => undefined),
  );

/** ★ EXPORTED for kubeconfig.test.ts — see talos-bootstrap.ts's own note on the pattern. */
export const readKubeconfig = (props: KubeconfigProps) =>
  Effect.gen(function* () {
    const meta = yield* readVaultMeta(props, props.kubeconfigKey ?? DEFAULT_KUBECONFIG_KEY);
    return meta ?? emptyAttrs(props);
  });

export const diffKubeconfig = (
  news: Input<KubeconfigProps>,
  output: KubeconfigAttributes | undefined,
) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* readKubeconfig(news);
    if (
      live.credentialGeneration !== '' &&
      output.credentialGeneration === live.credentialGeneration &&
      output.context === live.context &&
      output.endpoint === live.endpoint
    ) {
      return { action: 'noop' } as const;
    }
    return { action: 'update' } as const;
  });

/**
 * ⛔ WRAPPED IN `Effect.scoped` — same C1-lifetime reasoning as every other Talos resource file:
 *   `mintTalosconfig` and `reservedTempPath` both contribute `Scope.Scope`, and this is the caller
 *   that owns their lifetime for the whole reconcile.
 * ⛔ WRITE-ONCE — see this file's own header. `output !== undefined` means a bring-up already ran;
 *   this branch never spawns `talosctl kubeconfig` or writes to the vault again.
 */
export const reconcileKubeconfig = (
  props: KubeconfigProps,
  output: KubeconfigAttributes | undefined,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const key = props.kubeconfigKey ?? DEFAULT_KUBECONFIG_KEY;

      if (output !== undefined) {
        const raw = yield* readKvValue(props.target.mount, key, ['kubeconfig', 'config']);
        const meta = buildAttrs(raw, props);
        if (meta === undefined) {
          return yield* Effect.die(
            new Error(
              `${props.target.mount}/${key}: vault content no longer parses as a kubeconfig for ` +
                `context ${props.context}. Read back rather than trusting the write once.`,
            ),
          );
        }
        return meta;
      }

      const credential = yield* mintTalosconfig(props.target);
      const { path: outPath } = yield* reservedTempPath(
        `${props.target.cluster}-${props.node}-kubeconfig-out`,
      );
      yield* talosctl(
        ['kubeconfig', outPath, '--merge=false', '--force', '--force-context-name', props.context],
        { nodes: [props.node], talosconfigPath: credential.talosconfigPath },
      );
      const raw = yield* Effect.tryPromise({
        catch: (cause) => new Error(`${outPath}: reading generated kubeconfig: ${String(cause)}`),
        try: () => Bun.file(outPath).text(),
      });
      if (raw.trim() === '') {
        return yield* Effect.die(
          new Error(
            `${props.node}: talosctl kubeconfig returned no error but wrote an empty file. Read ` +
              'back rather than trusting the exit code alone.',
          ),
        );
      }
      // ⚠️ REASONED, not measured: talosctl's own writer likely already uses 0600 like most Go
      //   credential writers, but this chmods defensively regardless — same posture as
      //   credentials.ts's mintKvTempFile.
      yield* Effect.try({
        catch: (cause) => new Error(`${outPath}: chmod 0600: ${String(cause)}`),
        try: () => chmodSync(outPath, 0o600),
      });
      const meta = buildAttrs(raw, props);
      if (meta === undefined) {
        return yield* Effect.die(
          new Error(
            `${props.node}: talosctl kubeconfig wrote a file that does not parse for context ` +
              `${props.context}.`,
          ),
        );
      }
      yield* writeKvValue(props.target.mount, key, 'kubeconfig', raw);
      return meta;
    }),
  );

const handlers = {
  delete: () => Effect.void,
  diff: ({
    news,
    output,
  }: {
    news: Input<KubeconfigProps>;
    output: KubeconfigAttributes | undefined;
  }) => diffKubeconfig(news, output),
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: KubeconfigProps }) => readKubeconfig(olds),
  reconcile: ({
    news,
    output,
  }: {
    news: KubeconfigProps;
    output: KubeconfigAttributes | undefined;
  }) => reconcileKubeconfig(news, output),
};

export const TalosKubeconfigProvider = () =>
  Provider.effect(TalosKubeconfig, Effect.succeed(TalosKubeconfig.Provider.of(handlers)));
