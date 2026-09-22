---
'@homeflare/alchemy': patch
---

`Proxmox.Lxc`'s guide now says what a container's **inside** is, and pins it with a test.

`Proxmox.Lxc` declares the keys in `/nodes/{node}/lxc/{vmid}/config` and nothing within the guest's
filesystem. Every consumer that meets that limit goes looking for the resource that must surely
exist — an exec, a file write, a cloud-init. **For containers it does not exist in PVE's API at
all.** QEMU VMs have `POST …/qemu/{vmid}/agent/exec`, `…/agent/file-write`, `…/agent/file-read` and
a `cloudinit` subtree; the complete `/nodes/{node}/lxc/{vmid}/…` endpoint set has no counterpart.
The only reach inside is `termproxy` / `vncwebsocket`, an interactive console for a person.

- `docs/proxmox-lxc.md` gains that table under **Gaps**, and says plainly that a generic,
  vendor-API-based Resource for a container's interior cannot be written: there is nothing to
  wrap. What is left, in the order that keeps a change declarative — bake it into the template
  (⚠️ `ostemplate` is create-only, so changing it REPLACES the guest), a first-boot artifact, or a
  recorded one-time human step named as undeclared.
- ⛔ It also says why an exec-over-SSH resource is not option zero: it needs a credential and a
  network path _to the guest_, so when the guest is what provides credentials, naming or reach to
  others, it inverts the bootstrap — the new system's first boot depends on its own output. The
  `HostRunner` seam in `@homeflare/alchemy/launchd` is where such a runner plugs in, and the kit
  ships only `localRunner()` and `sudoRunner()` on purpose.
- ⚠️ **Sibling families are not at parity.** QEMU and LXC sit under the same `/nodes/{node}/…` tree
  with completely different reach; the guide now says not to infer one from the other.
- `src/proxmox/lxc-interior.test.ts` checks this against the generated schema on every run, so it
  fails the day PVE adds such an endpoint — which is exactly when the kit would want to wrap it.
  Its positive control asserts QEMU's three are present, so a change to the generated file's shape
  fails the test instead of making every absence assertion pass for free.

Docs and a test only. No resource, type or behaviour changed.
