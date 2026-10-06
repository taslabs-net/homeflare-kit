/**
 * `Talos.Kubeconfig`'s attribute builder — split out of kubeconfig.ts (LAND, 2026-09-26, C1/I2
 * fixes) once fixing those findings pushed the file over the 250-line cap. Only `import type`
 * comes back from kubeconfig.ts, so there is no runtime cycle.
 *
 * ⛔ NO `connection` HERE. A connection names the PHYSICAL cluster (`{ kind, cluster, uid }`,
 *   cluster-adapter.ts's identity rule) and the uid is only knowable from the cluster, which does
 *   not exist yet when this resource writes the vault key. `Talos.ClusterIdentity` publishes the
 *   connection; a name-only connection would be refused by the adapter at connect. Neither the
 *   stock `kubeconfig` kind (an absent path falls back to `$KUBECONFIG`) nor `client-cert` (PEM on
 *   every workload's attributes, `Connection.ts` v2.0.0-beta.79 lines 12-14) is ever used.
 */
import type { KubeconfigAttributes, KubeconfigProps } from './kubeconfig.ts';
import { kubeconfigMetadata, sha256 } from './values.ts';

const generation = (meta: {
  endpoint: string;
  caFingerprint: string;
  clientFingerprint: string;
  context: string;
}) => sha256(`${meta.context}\n${meta.endpoint}\n${meta.caFingerprint}\n${meta.clientFingerprint}`);

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
    context: props.context,
    credentialGeneration: generation({ ...meta, context: props.context }),
    endpoint: meta.endpoint,
  };
};
