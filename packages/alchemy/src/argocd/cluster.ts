/**
 * `Argocd.Cluster` — a target Kubernetes cluster registered with an Argo CD instance
 * (`/api/v1/clusters`) so Applications can deploy onto it. REST-managed, not a CRD; see
 * `docs/argocd.md`. This is how the house will register the Talos-on-PVE cluster itself with
 * Argo CD once both exist — Argo CD's own control-plane cluster (where Argo CD is installed) is
 * registered implicitly as `https://kubernetes.default.svc` and never needs this resource.
 *
 * ⚠️ ONLY BEARER-TOKEN AND STATIC TLS CLIENT-CERT AUTH ARE SUPPORTED. `V1alpha1ClusterConfig` also
 *   carries `awsAuthConfig` (EKS IAM) and `execProviderConfig` (an exec plugin) — measured in
 *   `services/argocd.ts`, distilled homeflare/base — neither of which applies to a Talos cluster;
 *   left unbuilt rather than modeled and untested.
 *
 * ⚠️ NO LIVE ARGO CD INSTANCE EXISTS ON THE ESTATE (2026-09-24) — see `docs/argocd.md`.
 *
 * ⛔ `defaultRemovalPolicy: 'retain'` — deregistering a cluster Applications still target breaks
 *   their sync. `delete` below is fully implemented; opt in with `.pipe(RemovalPolicy.destroy())`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as argocd from '@distilled.cloud/argocd/argocd';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { type FromEnv, resolveAll } from '../secrets/write-only.ts';
import { type ArgocdRequirements, type ArgocdSpec, argocdHandlers, present } from './resource.ts';

export interface ClusterCredentialRefs {
  readonly password?: FromEnv;
  readonly bearerToken?: FromEnv;
  readonly tlsClientKeyData?: FromEnv;
}

export interface ClusterProps {
  /** The cluster's API server URL — identity key; changing it is a replace. */
  server: string;
  name?: string;
  /** Restricts this cluster to one Argo CD project; omit for every project. */
  project?: string;
  namespaces?: readonly string[];
  clusterResources?: boolean;
  labels?: Readonly<Record<string, string>>;
  annotations?: Readonly<Record<string, string>>;
  proxyUrl?: string;
  username?: string;
  tlsCaData?: string;
  /** The client certificate itself — public, unlike its key. */
  tlsCertData?: string;
  tlsInsecure?: boolean;
  tlsServerName?: string;
  /** Write-only — never a value here, only env var names. See the module header. */
  credentials?: ClusterCredentialRefs;
}

export interface ClusterAttributes {
  server: string;
  name: string | undefined;
  project: string | undefined;
  namespaces: readonly string[] | undefined;
  clusterResources: boolean | undefined;
  labels: Readonly<Record<string, string>> | undefined;
  annotations: Readonly<Record<string, string>> | undefined;
  proxyUrl: string | undefined;
  username: string | undefined;
  tlsCaData: string | undefined;
  tlsCertData: string | undefined;
  tlsInsecure: boolean | undefined;
  tlsServerName: string | undefined;
}

export interface ArgocdCluster extends Resource<
  'Argocd.Cluster',
  ClusterProps,
  ClusterAttributes,
  never,
  ArgocdRequirements
> {}

export const ArgocdCluster = Resource<ArgocdCluster>('Argocd.Cluster', {
  defaultRemovalPolicy: 'retain',
});

/** Domain refusal, not a distilled error — a declared credential's env var is unset at call time. */
export class ArgocdClusterSecretEnvUnsetError extends Data.TaggedError(
  'ArgocdClusterSecretEnvUnsetError',
)<{
  readonly message: string;
}> {}

interface ResolvedClusterCredentials {
  readonly password?: string;
  readonly bearerToken?: string;
  readonly tlsClientKeyData?: string;
}

const resolveClusterCredentials = (
  refs: ClusterCredentialRefs,
): Effect.Effect<ResolvedClusterCredentials, ArgocdClusterSecretEnvUnsetError> => {
  const declared: Record<string, FromEnv> = {};
  if (refs.password !== undefined) declared.password = refs.password;
  if (refs.bearerToken !== undefined) declared.bearerToken = refs.bearerToken;
  if (refs.tlsClientKeyData !== undefined) declared.tlsClientKeyData = refs.tlsClientKeyData;
  const { values, missing } = resolveAll(declared);
  if (missing.length > 0) {
    return Effect.fail(
      new ArgocdClusterSecretEnvUnsetError({
        message:
          `credential write requires ${missing.join(', ')}, unset or empty in the ` +
          'deploying environment. Export it and deploy again.',
      }),
    );
  }
  return Effect.succeed(values as ResolvedClusterCredentials);
};

/**
 * `V1alpha1Cluster.labels`/`.annotations` decode as `{ [key: string]: string | undefined }` — a
 * generated index-signature artifact, not a real possibility on the wire (a label/annotation map
 * never carries an `undefined` value). Cast at this one boundary rather than threading the looser
 * type through `ClusterAttributes`.
 */
const attributesOf = (live: argocd.V1alpha1Cluster): ClusterAttributes => ({
  annotations: live.annotations as Record<string, string> | undefined,
  clusterResources: live.clusterResources,
  labels: live.labels as Record<string, string> | undefined,
  name: live.name,
  namespaces: live.namespaces,
  project: live.project,
  proxyUrl: live.config?.proxyUrl,
  server: live.server ?? '',
  tlsCaData: live.config?.tlsClientConfig?.caData,
  tlsCertData: live.config?.tlsClientConfig?.certData,
  tlsInsecure: live.config?.tlsClientConfig?.insecure,
  tlsServerName: live.config?.tlsClientConfig?.serverName,
  username: live.config?.username,
});

const sameRecord = (
  a: Readonly<Record<string, string>> | undefined,
  b: Readonly<Record<string, string>> | undefined,
) =>
  JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

/** Only the plain fields — Argo CD never returns the password/bearer token/private key back. */
const plainMatches = (attrs: ClusterAttributes, props: ClusterProps): boolean =>
  (props.name ?? undefined) === (attrs.name ?? undefined) &&
  (props.project ?? undefined) === (attrs.project ?? undefined) &&
  sameList(props.namespaces, attrs.namespaces) &&
  Boolean(props.clusterResources) === Boolean(attrs.clusterResources) &&
  sameRecord(props.labels, attrs.labels) &&
  sameRecord(props.annotations, attrs.annotations) &&
  (props.proxyUrl ?? undefined) === (attrs.proxyUrl ?? undefined) &&
  (props.username ?? undefined) === (attrs.username ?? undefined) &&
  (props.tlsCaData ?? undefined) === (attrs.tlsCaData ?? undefined) &&
  (props.tlsCertData ?? undefined) === (attrs.tlsCertData ?? undefined) &&
  Boolean(props.tlsInsecure) === Boolean(attrs.tlsInsecure) &&
  (props.tlsServerName ?? undefined) === (attrs.tlsServerName ?? undefined);

type ClusterError =
  | argocd.GetClusterServiceError
  | argocd.CreateClusterServiceError
  | argocd.DeleteClusterServiceError
  | ArgocdClusterSecretEnvUnsetError;

/** ★ EXPORTED for direct testing against `fake-argocd.ts` — see `cluster.test.ts`. */
export const spec: ArgocdSpec<
  ClusterProps,
  argocd.V1alpha1Cluster,
  ClusterAttributes,
  ClusterError
> = {
  attributes: (live) => attributesOf(live),
  destroy: (props) => argocd.deleteClusterService({ id_value: props.server }),
  identityOfAttributes: (attrs) => attrs.server,
  identityOfProps: (props) => props.server,
  fetchLive: (props) =>
    argocd
      .getClusterService({ id_value: props.server })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: plainMatches,
  upsert: (props) =>
    resolveClusterCredentials(props.credentials ?? {}).pipe(
      Effect.flatMap((creds) =>
        argocd.createClusterService(
          present({
            upsert: true,
            annotations: props.annotations,
            clusterResources: props.clusterResources,
            config: present({
              bearerToken: creds.bearerToken,
              password: creds.password,
              proxyUrl: props.proxyUrl,
              tlsClientConfig: present({
                caData: props.tlsCaData,
                certData: props.tlsCertData,
                insecure: props.tlsInsecure,
                keyData: creds.tlsClientKeyData,
                serverName: props.tlsServerName,
              }),
              username: props.username,
            }),
            labels: props.labels,
            name: props.name,
            namespaces: props.namespaces === undefined ? undefined : [...props.namespaces],
            project: props.project,
            server: props.server,
          }),
        ),
      ),
    ),
};

export const handlers = argocdHandlers(spec);

export const ArgocdClusterProvider = () =>
  Provider.effect(ArgocdCluster, Effect.succeed(ArgocdCluster.Provider.of(handlers)));
