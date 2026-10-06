/**
 * Typed failures of the `talos-openbao` adapter — split out of cluster-adapter.ts to keep each
 * class's own header out of that file's 250-line budget. No message names document bytes.
 */
import * as Data from 'effect/Data';

/** The connection's uid matches no adapter entry. Uids are public. */
export class TalosOpenBaoUnknownCluster extends Data.TaggedError('TalosOpenBaoUnknownCluster')<{
  readonly uid: string;
  readonly known: readonly string[];
}> {
  override get message(): string {
    return (
      `talos-openbao adapter has no entry pinned to cluster uid ${this.uid} ` +
      `(configured uids: ${this.known.join(', ') || 'none'}). Refused rather than reading ` +
      "another cluster's kubeconfig. If the cluster was retired, keep its entry with " +
      '`retired: true` and its uid until its rows are destroyed.'
    );
  }
}

/** Two adapter entries pin the same uid, so which vault key to read is ambiguous. */
export class TalosOpenBaoAmbiguousUid extends Data.TaggedError('TalosOpenBaoAmbiguousUid')<{
  readonly uid: string;
  readonly aliases: readonly string[];
}> {
  override get message(): string {
    return (
      `talos-openbao adapter entries ${this.aliases.join(', ')} are all pinned to uid ` +
      `${this.uid}. Refused instead of picking one: a uid names exactly one entry.`
    );
  }
}

/** The saved auth block still carries the alias an earlier build of this branch persisted. */
export class TalosOpenBaoLegacyAuth extends Data.TaggedError('TalosOpenBaoLegacyAuth')<{
  readonly _?: never;
}> {
  override get message(): string {
    return (
      'talos-openbao connection carries a legacy `cluster` alias in its auth block. Refused ' +
      'before any vault read or request, with no silent migration (old and new auth differ, so ' +
      'upstream would PATCH then DELETE the same object). Remedy: edit the saved state ONCE so ' +
      "each such row's `connection.auth` is `{ kind: 'talos-openbao', uid }` (drop `cluster`), " +
      'then redeploy.'
    );
  }
}

/** `Talos.ClusterIdentity` read a different uid than the one it published. Never an update. */
export class TalosClusterMoved extends Data.TaggedError('TalosClusterMoved')<{
  readonly cluster: string;
  readonly saved: string;
  readonly live: string;
}> {
  override get message(): string {
    return (
      `Talos.ClusterIdentity '${this.cluster}' published uid ${this.saved} but the vault key now ` +
      `answers as ${this.live}. Refused, not updated: an update cannot become a replace for the ` +
      'workloads downstream, so the new cluster would be force-applied and the old one orphaned. ' +
      'A move is explicit: declare a NEW Talos.ClusterIdentity for the new cluster and leave this ' +
      'one pointing at the old cluster until its workloads are destroyed.'
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
  readonly _?: never;
}> {
  override get message(): string {
    return (
      'talos-openbao connection carries no uid, so it cannot say which physical cluster it ' +
      'targets. Refused before any vault read or request: wire workloads to ' +
      '`Talos.ClusterIdentity` (its `connection` carries the uid).'
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

/** The kube-system GET got no answer in time: a silent apiserver must not hang connect or plan. */
export class TalosClusterIdentityTimeout extends Data.TaggedError('TalosClusterIdentityTimeout')<{
  readonly cluster: string;
  readonly seconds: number;
}> {
  override get message(): string {
    return (
      `talos-openbao cluster '${this.cluster}': no answer to the kube-system uid read within ` +
      `${this.seconds}s. Refused (failed closed) rather than waiting on a silent apiserver.`
    );
  }
}

/**
 * The whole connect path (vault read, parse, kube-system uid read) did not finish in time. One
 * deadline covers `bao` and the apiserver together: a hung `bao` or a silent apiserver must not
 * hang connect or a plan. The `bao` child is killed when the deadline interrupts the read.
 */
export class TalosOpenBaoConnectTimeout extends Data.TaggedError('TalosOpenBaoConnectTimeout')<{
  readonly cluster: string;
  readonly seconds: number;
}> {
  override get message(): string {
    return (
      `talos-openbao cluster '${this.cluster}': vault read and identity check did not finish ` +
      `within ${this.seconds}s. Refused (failed closed); the bao child was killed.`
    );
  }
}

/** A connection was built from a uid that is not a plain string known at plan time. */
export class TalosUidNotLiteral extends Data.TaggedError('TalosUidNotLiteral')<{
  readonly _?: never;
}> {
  override get message(): string {
    return (
      'talos-openbao connection uid must be a literal string taken from the adapter config, not ' +
      'an Output (for example a Talos.ClusterIdentity attribute). An unresolved uid hides a ' +
      "cluster change from the plan: upstream would plan an UPDATE and reconcile the old cluster's " +
      'objects on the new one. Pin the uid in `TalosOpenBaoAdapter` and take it from there.'
    );
  }
}
