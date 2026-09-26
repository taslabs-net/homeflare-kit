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
 * ⛔ BOOTSTRAP, CLUSTERHEALTH AND KUBECONFIG STAY PROVIDER-ONLY (PR 307 red team, fix-first #3).
 *   Exporting their Resource constructors would let a stack actually declare them, and today that
 *   is not safe: `Talos.Bootstrap` can plan and run a second `talosctl bootstrap` after a failing
 *   plan-time read (the etcd split-brain risk docs/plans/2026-09-26-talos-stack-first-boot.md's
 *   "Bootstrap — once means once" section names, still open), and `Talos.Kubeconfig` still writes a
 *   cluster-admin kubeconfig to un-vaulted host disk (the secrets-flow doc's "Measured today"
 *   section, also still open). Their own K-A3 follow-ups land these exports when the fixes do.
 * ★ Anything unlisted is still reachable by path if you genuinely need it — that is a
 *   deliberate, visible act rather than an accident of barrelling.
 */
export type { TalosCredential, TalosTarget } from './credentials.ts';
export { TalosKubeconfigProvider } from './kubeconfig.ts';
export type { ApplyMode, WithTarget } from './resource.ts';
export { TalosBootstrapProvider } from './talos-bootstrap.ts';
export { TalosClusterHealthProvider } from './talos-cluster-health.ts';
export {
  type MachineConfigAttributes,
  type MachineConfigProps,
  TalosMachineConfig,
  TalosMachineConfigProvider,
} from './talos-machine-config.ts';
