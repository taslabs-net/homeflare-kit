/**
 * `Talos.Kubeconfig`'s attribute builder and its `Kubernetes.Connection` — split out of
 * kubeconfig.ts (LAND, 2026-09-26, C1/I2 fixes) once fixing those findings pushed the file over the
 * 250-line cap, the same reason machine-config-read.ts/machine-config-poll.ts/talos-errors.ts were
 * split out of talos-machine-config.ts before it. Only `import type` comes back from kubeconfig.ts,
 * so there is no runtime cycle between the two files.
 */
import type { Connection } from 'alchemy/Kubernetes/Connection';
import type { KubeconfigAttributes, KubeconfigProps } from './kubeconfig.ts';
import { kubeconfigMetadata, sha256 } from './values.ts';

const generation = (meta: {
  endpoint: string;
  caFingerprint: string;
  clientFingerprint: string;
  context: string;
}) => sha256(`${meta.context}\n${meta.endpoint}\n${meta.caFingerprint}\n${meta.clientFingerprint}`);

/**
 * ⛔ I2 FIX (LAND red team, 2026-09-26) — NEVER LEAVE `path` UNDEFINED. An undefined `path` here
 *   made the stock `Kubernetes.KubeConfigAdapter` fall back to `$KUBECONFIG`/`~/.kube/config`
 *   (alchemy `Kubernetes/internal/kubeconfig.ts`'s `resolveKubeConfigPath`, wired in
 *   `BuiltinAdapters.ts`) — exactly the un-vaulted, possibly-stale-context exposure this whole
 *   family exists to remove. A consumer wiring `Kubernetes.*` to `kube.connection` (this
 *   attribute's own doc invites exactly that) would silently connect through whatever
 *   `admin@<cluster>` context happens to be on the operator's machine. `Kubernetes.ClusterAdapter`
 *   is not yet wired to `mintKubeconfig` (kubeconfig.ts's own header) — no real path exists for
 *   this connection to use — so it must fail LOUDLY instead of silently succeeding against a
 *   stranger's cluster. A path that can never resolve does that: `resolveKubeContext` fails at
 *   `fs.readFileString` naming this exact sentinel, instead of reading whatever real file happens
 *   to be on `$KUBECONFIG`.
 */
const UNWIRED_KUBECONFIG_PATH =
  '/talos-first-boot-unwired/wire-Kubernetes.ClusterAdapter-to-mintKubeconfig';

const toConnection = (props: KubeconfigProps): Connection => ({
  auth: { context: props.context, kind: 'kubeconfig', path: UNWIRED_KUBECONFIG_PATH },
});

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
