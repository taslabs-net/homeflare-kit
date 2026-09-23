/**
 * The barrel's TYPE surface, pinned.
 *
 * ⛔ THIS IS THE TEST FOR A BUG THAT ONLY A CONSUMER COULD SEE. Every `Bao.*` family already
 *   re-exported its `…Props` and `…Attributes` from its own module, but `index.ts` forwarded only
 *   the VALUES for seven of them. A consumer that may not deep-import — which is every consumer,
 *   by the estate's adoption rules — therefore could not name the props of the very Resource the
 *   barrel handed it, and had to write the shape out and hope it stayed in step.
 *   MEASURED 2026-09-22 in homeflare-openbao, which did exactly that for `BaoProxmoxRole`.
 *
 * ★ A TYPE-ONLY TEST, ON PURPOSE. Nothing here runs; `tsc --noEmit` is the assertion. If a family's
 *   props stop being reachable from the package entry, this file stops compiling, which is the
 *   only moment anyone would otherwise notice — at the next consumer, in another repo.
 */
import type {
  BaoAuthMethodAttributes,
  BaoAuthMethodProps,
  BaoAuthRoleAttributes,
  BaoAuthRoleProps,
  BaoCloudflareRoleAttributes,
  BaoCloudflareRoleProps,
  BaoJwtRoleAttributes,
  BaoMountAttributes,
  BaoMountProps,
  BaoPkiRoleAttributes,
  BaoPkiRoleProps,
  BaoPluginAttributes,
  BaoPluginProps,
  BaoPolicyAttributes,
  BaoPolicyProps,
  BaoProxmoxRoleAttributes,
  BaoProxmoxRoleProps,
  BaoSshRoleAttributes,
  BaoSshRoleProps,
} from './index.ts';
import { expect, test } from 'bun:test';

/**
 * ⛔ The one a consumer was already missing. `mount` + `name` + `mintUser` + `ttl` + `maxTtl` IS the
 *   whole role, so a consumer that writes this shape out by hand is writing the entire
 *   server-side state of the family — including `mintUser`, which is its security boundary.
 */
const proxmoxRole: BaoProxmoxRoleProps = {
  maxTtl: '30m',
  mintUser: 'hf-provision@pve',
  mount: 'proxmox-ops',
  name: 'provision',
  ttl: '5m',
};

const mount: BaoMountProps = { path: 'proxmox-ops', type: 'openbao-plugin-secrets-proxmox' };

/** ⛔ The plugin catalog key — a consumer needs this to declare a registration at all. */
const plugin: BaoPluginProps = {
  command: 'openbao-plugin-secrets-proxmox',
  name: 'openbao-plugin-secrets-proxmox',
  sha256: 'a'.repeat(64),
  type: 'secret',
  version: 'v0.0.0-dev',
};

/** ★ Named so the attribute types are reachable too: a consumer reads outputs as well as writing props. */
type Reachable =
  | BaoAuthMethodAttributes
  | BaoAuthMethodProps
  | BaoAuthRoleAttributes
  | BaoAuthRoleProps
  | BaoCloudflareRoleAttributes
  | BaoCloudflareRoleProps
  | BaoJwtRoleAttributes
  | BaoMountAttributes
  | BaoPkiRoleAttributes
  | BaoPkiRoleProps
  | BaoProxmoxRoleAttributes
  | BaoPluginAttributes
  | BaoPolicyAttributes
  | BaoPolicyProps
  | BaoSshRoleAttributes
  | BaoSshRoleProps;

test("every openbao family's props are reachable from the package entry", () => {
  const reachable: Reachable[] = [];
  expect(reachable).toEqual([]);
  expect(proxmoxRole.mintUser).toBe('hf-provision@pve');
  expect(mount.type).toBe('openbao-plugin-secrets-proxmox');
  expect(plugin.version).toBe('v0.0.0-dev');
});
