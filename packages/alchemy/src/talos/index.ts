/**
 * Talos providers for Alchemy.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY.
 *   These are the symbols a real stack consumes; the rest of the files are internals a
 *   provider needs but a consumer should not depend on. An `export *` here would publish
 *   every helper as API and make the next refactor a breaking change.
 * ★ THE RESOURCE CLASSES JOINED THE PROVIDERS 2026-09-26 (K-A3) — until now this barrel exported
 *   only `Talos*Provider`, which builds the provider but gives a consuming stack nothing to
 *   `new` or call to actually DECLARE a `Talos.MachineConfig`/`Talos.Bootstrap`/etc. row (the same
 *   gap proxmox/index.ts's own header calls out for `ProxmoxVm`). Every family here is already
 *   safe to declare from a stack: none adopts silently, MachineConfig fails closed on a digest
 *   mismatch before touching a node, and Bootstrap defaults to `retain`.
 * ★ Anything unlisted is still reachable by path if you genuinely need it — that is a
 *   deliberate, visible act rather than an accident of barrelling.
 */
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
