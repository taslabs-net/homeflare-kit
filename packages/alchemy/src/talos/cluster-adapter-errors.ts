/**
 * Typed failures of the `talos-openbao` adapter — split out of cluster-adapter.ts to keep each
 * class's own header out of that file's 250-line budget. No message names document bytes.
 */
import * as Data from 'effect/Data';

/** The connection names a cluster this adapter was not configured for. */
export class TalosOpenBaoUnknownCluster extends Data.TaggedError('TalosOpenBaoUnknownCluster')<{
  readonly cluster: string;
  readonly known: readonly string[];
}> {
  override get message(): string {
    return (
      `talos-openbao adapter has no configuration for cluster '${this.cluster}' ` +
      `(configured: ${this.known.join(', ') || 'none'}). Refused rather than reading another ` +
      "cluster's kubeconfig."
    );
  }
}

/** `bao kv get` reported the key unwritten. The message names `mount/key` and no document bytes. */
export class TalosVaultKeyMissing extends Data.TaggedError('TalosVaultKeyMissing')<{
  readonly mount: string;
  readonly key: string;
}> {
  override get message(): string {
    return (
      `${this.mount}/${this.key}: OpenBao has no value at this key. Talos.Kubeconfig writes it ` +
      'once at bring-up. Connect refused instead of reading a kubeconfig from disk.'
    );
  }
}

/** Vault bytes exist but are not a kubeconfig for the pinned context. The document is not echoed. */
export class TalosKubeconfigUnreadable extends Data.TaggedError('TalosKubeconfigUnreadable')<{
  readonly mount: string;
  readonly key: string;
  readonly context: string;
}> {
  override get message(): string {
    return (
      `${this.mount}/${this.key}: OpenBao kubeconfig does not parse for context ${this.context}. ` +
      'The document stayed in the vault. Connect wrote nothing to disk and nothing to state.'
    );
  }
}

/** The layer was asked to connect a different auth kind. */
export class TalosOpenBaoAuthKind extends Data.TaggedError('TalosOpenBaoAuthKind')<{
  readonly kind: string;
}> {
  override get message(): string {
    return (
      `talos-openbao adapter received auth kind '${this.kind}'. This adapter only connects ` +
      '`talos-openbao`.'
    );
  }
}

/** The saved auth block carries no `uid`, so nothing says WHICH physical cluster it meant. */
export class TalosClusterIdentityMissing extends Data.TaggedError('TalosClusterIdentityMissing')<{
  readonly cluster: string;
}> {
  override get message(): string {
    return (
      `talos-openbao connection for cluster '${this.cluster}' carries no uid, so it cannot say ` +
      'which physical cluster it targets. Refused before any vault read or request: wire ' +
      'workloads to `Talos.ClusterIdentity` (its `connection` carries the uid), not to a bare ' +
      'cluster name.'
    );
  }
}

/** The cluster that answered is not the one the saved auth block named. Uids are public. */
export class TalosClusterIdentityMismatch extends Data.TaggedError('TalosClusterIdentityMismatch')<{
  readonly cluster: string;
  readonly expected: string;
  readonly got: string;
}> {
  override get message(): string {
    return (
      `talos-openbao cluster '${this.cluster}' answered as kube-system uid ${this.got}, but the ` +
      `saved connection expects ${this.expected}. Refused before any apply or delete: the name ` +
      'now resolves to a different physical cluster. If the original cluster is gone for good, ' +
      'remove its rows from state deliberately.'
    );
  }
}

/** `GET /api/v1/namespaces/kube-system` answered without a usable `metadata.uid`. */
export class TalosClusterIdentityUnreadable extends Data.TaggedError(
  'TalosClusterIdentityUnreadable',
)<{
  readonly cluster: string;
}> {
  override get message(): string {
    return (
      `talos-openbao cluster '${this.cluster}': kube-system has no readable metadata.uid. ` +
      'Refused rather than assuming the cluster is the expected one.'
    );
  }
}
