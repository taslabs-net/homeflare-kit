/**
 * Talos providers for Alchemy.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY.
 *   These are the symbols a real stack consumes; the rest of the files are internals a
 *   provider needs but a consumer should not depend on. An `export *` here would publish
 *   every helper as API and make the next refactor a breaking change.
 * ★ `Talos.MachineConfig`'S RESOURCE CLASS JOINED ITS PROVIDER 2026-09-26 (K-A3) — until now this
 *   barrel exported only `Talos*Provider`, which builds the provider but gives a consuming stack
 *   nothing to `new` or call to actually DECLARE a row (the same gap proxmox/index.ts's own header
 *   calls out for `ProxmoxVm`). MachineConfig is safe to declare today: it fails closed on a digest
 *   mismatch before touching a node, and its cold-start read never silently adopts (PR 307 fix-first
 *   #1, machine-config-read.ts's own header).
 * ★ BOOTSTRAP, CLUSTERHEALTH AND KUBECONFIG JOIN THEM (K-talos-first-boot, 2026-09-26) — PR 307's
 *   red team (fix-first #3) held these back because `Talos.Bootstrap` could re-run `talosctl
 *   bootstrap` against an already-bootstrapped cluster and `Talos.Kubeconfig` wrote a cluster-admin
 *   kubeconfig to un-vaulted host disk. Both are fixed now: bootstrap's "once means once" invariant
 *   (talos-bootstrap.ts's own header) and kubeconfig landing in OpenBao, written once at bring-up
 *   (kubeconfig.ts's own header) — plus `Talos.ClusterHealth`'s error handling no longer conflates a
 *   vault/transport failure with "cluster not healthy yet" (talos-cluster-health.ts's own header).
 * ★ `talos-openbao` (K-A5) is how `Kubernetes.*` reaches the cluster: `TalosOpenBaoAdapter`,
 *   the connection `Talos.Kubeconfig` persists, and `HF_TALOSCTL` to pin the talosctl binary.
 * ★ Anything unlisted is still reachable by path if you genuinely need it — that is a
 *   deliberate, visible act rather than an accident of barrelling.
 */
export {
  TalosKubeconfigUnreadable,
  TalosOpenBaoAdapter,
  TalosOpenBaoAuthKind,
  TalosVaultKeyMissing,
  connectTalosOpenBao,
  talosOpenBaoConnection,
} from './cluster-adapter.ts';
export type { TalosCredential, TalosTarget } from './credentials.ts';
export {
  type KubeconfigAttributes,
  type KubeconfigProps,
  TalosKubeconfig,
  TalosKubeconfigProvider,
} from './kubeconfig.ts';
export type { ApplyMode, WithTarget } from './resource.ts';
export {
  type BootstrapAttributes,
  type BootstrapProps,
  TalosBootstrap,
  TalosBootstrapProvider,
} from './talos-bootstrap.ts';
export {
  type ClusterHealthAttributes,
  type ClusterHealthProps,
  TalosClusterHealth,
  TalosClusterHealthProvider,
} from './talos-cluster-health.ts';
export {
  type MachineConfigAttributes,
  type MachineConfigProps,
  TalosMachineConfig,
  TalosMachineConfigProvider,
} from './talos-machine-config.ts';
export { DEFAULT_TALOSCTL_BINARY, TALOSCTL_BINARY_ENV } from './talosctl.ts';
