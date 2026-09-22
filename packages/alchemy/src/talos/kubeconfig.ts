/**
 * `Talos.Kubeconfig` — fetch admin kubeconfig so `Kubernetes.*` workloads can connect.
 *
 * ★ REASONED FROM talosctl kubeconfig (Talos v1.13 CLI reference): writes a kubeconfig file;
 *   `--merge=false` keeps it isolated; `-f/--force` overwrites an existing file.
 *
 * ⛔ THE KUBECONFIG FILE CONTAINS A CLIENT CERTIFICATE — IT MUST NOT BE AN ATTRIBUTE. Alchemy
 *   persists attributes unencrypted. This resource:
 *     - writes the file to `runtimePath` at reconcile time (re-minted each deploy),
 *     - persists ONLY public metadata + fingerprints,
 *     - exposes a `connection` field referencing the runtime path for `Kubernetes.ClusterAdapter`.
 *
 * ⚠️ `runtimePath` IS PERSISTED AS A STRING, NOT AS FILE CONTENTS. The path is a contract between
 *   this resource and the host filesystem — same pattern as pointing Kubernetes.KubeConfig at
 *   `/opt/homeflare/...` rendered outside Postgres.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import type { Connection } from 'alchemy/Kubernetes/Connection';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { mintTalosconfig } from './credentials.ts';
import type { TalosRequirements, WithTarget } from './resource.ts';
import { talosctl } from './talosctl.ts';
import { kubeconfigMetadata, sha256 } from './values.ts';

export interface KubeconfigProps extends WithTarget {
  /** Node that serves `talosctl kubeconfig`. */
  node: string;
  /** Context name inside the generated kubeconfig — not secret. */
  context: string;
  /**
   * Host path where talosctl writes the kubeconfig each reconcile.
   *
   * ⛔ Must be outside Alchemy state and rotated by redeploy, never copied into attributes.
   */
  runtimePath: string;
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
   *   Only `path` and `context` appear here; the adapter reads credentials from disk at call time.
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
  auth: { context: props.context, kind: 'kubeconfig', path: props.runtimePath },
});

const readFileMeta = (props: KubeconfigProps) =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(props.runtimePath).text(),
      catch: (cause) => new Error(String(cause)),
    }).pipe(Effect.orElseSucceed(() => undefined as string | undefined));
    if (text === undefined) return undefined;
    const meta = kubeconfigMetadata(text, props.context);
    if (meta === undefined) return undefined;
    return {
      certificateAuthorityFingerprint: meta.caFingerprint,
      clientCertificateFingerprint: meta.clientFingerprint,
      connection: toConnection(props),
      context: props.context,
      credentialGeneration: generation({ ...meta, context: props.context }),
      endpoint: meta.endpoint,
    };
  });

const read = (props: KubeconfigProps) =>
  readFileMeta(props).pipe(
    Effect.map((meta) =>
      meta === undefined
        ? {
            certificateAuthorityFingerprint: '',
            clientCertificateFingerprint: '',
            connection: toConnection(props),
            context: props.context,
            credentialGeneration: '',
            endpoint: '',
          }
        : meta,
    ),
  );

const diff = (news: Input<KubeconfigProps>, output: KubeconfigAttributes | undefined) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* read(news);
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

const reconcile = (props: KubeconfigProps) =>
  Effect.gen(function* () {
    const credential = yield* mintTalosconfig(props.target);
    yield* talosctl(
      [
        'kubeconfig',
        props.runtimePath,
        '--merge=false',
        '--force',
        '--force-context-name',
        props.context,
      ],
      { nodes: [props.node], talosconfigPath: credential.talosconfigPath },
    );
    const meta = yield* readFileMeta(props);
    if (meta === undefined) {
      return yield* Effect.die(
        new Error(
          `${props.runtimePath}: talosctl kubeconfig returned no error but the file is missing ` +
            'or unparsable. Read back rather than trusting the exit code alone.',
        ),
      );
    }
    return meta;
  });

const handlers = {
  delete: () => Effect.void,
  diff: ({
    news,
    output,
  }: {
    news: Input<KubeconfigProps>;
    output: KubeconfigAttributes | undefined;
  }) => diff(news, output),
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: KubeconfigProps }) => read(olds),
  reconcile: ({ news }: { news: KubeconfigProps }) => reconcile(news),
};

export const TalosKubeconfigProvider = () =>
  Provider.effect(TalosKubeconfig, Effect.succeed(TalosKubeconfig.Provider.of(handlers)));
