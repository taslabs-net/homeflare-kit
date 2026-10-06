/**
 * `Talos.Kubeconfig`'s attribute builder and its `Kubernetes.Connection` — split out of
 * kubeconfig.ts (LAND, 2026-09-26, C1/I2 fixes) once fixing those findings pushed the file over the
 * 250-line cap. Only `import type` comes back from kubeconfig.ts, so there is no runtime cycle.
 *
 * ⛔ THE CONNECTION IS `talos-openbao`, NOT `kubeconfig` AND NOT `client-cert`. An absent
 *   `kubeconfig` path makes alchemy's `KubeConfigAdapter` fall back to `$KUBECONFIG`
 *   (`Kubernetes/internal/kubeconfig.ts` `resolveKubeConfigPath`). The `client-cert` kind persists
 *   PEM on every workload because `Connection.ts` (v2.0.0-beta.79, lines 12-14) stores the
 *   Connection on workload attributes. This object is `{ kind, cluster }` only; mount, key and
 *   context are `TalosOpenBaoAdapter({...})` configuration, because upstream replaces (and so
 *   deletes the same-named objects of) every workload whose auth block changes.
 */
import type { Connection } from 'alchemy/Kubernetes/Connection';
import { talosOpenBaoConnection } from './cluster-adapter.ts';
import type { KubeconfigAttributes, KubeconfigProps } from './kubeconfig.ts';
import { kubeconfigMetadata, sha256 } from './values.ts';

const generation = (meta: {
  endpoint: string;
  caFingerprint: string;
  clientFingerprint: string;
  context: string;
}) => sha256(`${meta.context}\n${meta.endpoint}\n${meta.caFingerprint}\n${meta.clientFingerprint}`);

const toConnection = (props: KubeconfigProps): Connection =>
  talosOpenBaoConnection(props.target.cluster);

/** Parse `raw` kubeconfig YAML into public, persistable attributes, or `undefined` if it fails to. */
export const buildAttrs = (
  raw: string,
  props: KubeconfigProps,
): KubeconfigAttributes | undefined => {
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
