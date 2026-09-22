/**
 * Generated pve-manager API types for `/nodes/node/qemu/vmid/config` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/types.ts    (`--check` compares without writing)
 * Manifest entry: `pve-apidoc` — pve-manager 9.2.11/f6997e698c7933ea
 *   sha256 9def8f13611184ee, read on a PVE cluster node from
 *   /usr/share/pve-docs/api-viewer/apidoc.js
 *
 * ⚠️ A REQUEST PARAMETER IS TEXT ON THE WIRE. `client.ts` sends form encoding, so an integer is
 *   `\`${number}\`` and a boolean is `'0' | '1'` — the spellings that reach the server. The
 *   vendor's BOUNDS on those values are enforced separately, at plan time, from
 *   pve/../constraints (codegen/README.md). A response is JSON and is not spelled that way.
 *
 * ⛔ 440 LINES, OVER THE HOUSE CAP OF 250, AND IT CANNOT BE SPLIT. This file holds ONE
 *   endpoint, and one type declaration is the smallest unit there is. The size is a vendor enum
 *   with hundreds of members (`mp0`…`mp255`, `unused0`…`unused255`); dropping it would widen the
 *   parameter back to `string`, which is the defect this generator exists to remove.
 *   codegen/types-split.ts carries the reasoning; tests/schema-types.test.ts pins the list.
 */

/** GET /nodes/{node}/qemu/{vmid}/config — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidConfigGetParams = { current?: '0' | '1'; snapshot?: string };
/** GET /nodes/{node}/qemu/{vmid}/config — `data` payload after client unwrap. */
export type NodesNodeQemuVmidConfigGetReturn = {
  acpi?: boolean | 0 | 1;
  affinity?: string;
  agent?: string;
  'allow-ksm'?: boolean | 0 | 1;
  'amd-sev'?: string;
  arch?: 'x86_64' | 'aarch64';
  args?: string;
  audio0?: string;
  autostart?: boolean | 0 | 1;
  balloon?: number;
  bios?: 'seabios' | 'ovmf';
  boot?: string;
  bootdisk?: string;
  cdrom?: string;
  cicustom?: string;
  cipassword?: string;
  citype?: 'configdrive2' | 'nocloud' | 'opennebula';
  ciupgrade?: boolean | 0 | 1;
  ciuser?: string;
  cores?: number;
  cpu?: string;
  cpulimit?: number;
  cpuunits?: number;
  description?: string;
  digest: string;
  efidisk0?: string;
  freeze?: boolean | 0 | 1;
  hookscript?: string;
  'hostpci[n]'?: string;
  hotplug?: string;
  hugepages?: 'any' | '2' | '1024';
  'ide[n]'?: string;
  'intel-tdx'?: string;
  'ipconfig[n]'?: string;
  ivshmem?: string;
  keephugepages?: boolean | 0 | 1;
  keyboard?:
    | 'de'
    | 'de-ch'
    | 'da'
    | 'en-gb'
    | 'en-us'
    | 'es'
    | 'fi'
    | 'fr'
    | 'fr-be'
    | 'fr-ca'
    | 'fr-ch'
    | 'hu'
    | 'is'
    | 'it'
    | 'ja'
    | 'lt'
    | 'mk'
    | 'nl'
    | 'no'
    | 'pl'
    | 'pt'
    | 'pt-br'
    | 'sv'
    | 'sl'
    | 'tr';
  kvm?: boolean | 0 | 1;
  localtime?: boolean | 0 | 1;
  lock?:
    | 'backup'
    | 'clone'
    | 'create'
    | 'migrate'
    | 'rollback'
    | 'snapshot'
    | 'snapshot-delete'
    | 'suspending'
    | 'suspended';
  machine?: string;
  memory?: string;
  meta?: string;
  migrate_downtime?: number;
  migrate_speed?: number;
  name?: string;
  nameserver?: string;
  'net[n]'?: string;
  numa?: boolean | 0 | 1;
  'numa[n]'?: string;
  onboot?: boolean | 0 | 1;
  ostype?:
    | 'other'
    | 'wxp'
    | 'w2k'
    | 'w2k3'
    | 'w2k8'
    | 'wvista'
    | 'win7'
    | 'win8'
    | 'win10'
    | 'win11'
    | 'l24'
    | 'l26'
    | 'solaris';
  'parallel[n]'?: string;
  parent?: string;
  protection?: boolean | 0 | 1;
  reboot?: boolean | 0 | 1;
  rng0?: string;
  'running-nets-host-mtu'?: string;
  runningcpu?: string;
  runningmachine?: string;
  'sata[n]'?: string;
  'scsi[n]'?: string;
  scsihw?: 'lsi' | 'lsi53c810' | 'virtio-scsi-pci' | 'virtio-scsi-single' | 'megasas' | 'pvscsi';
  searchdomain?: string;
  'serial[n]'?: string;
  shares?: number;
  smbios1?: string;
  smp?: number;
  snaptime?: number;
  sockets?: number;
  spice_enhancements?: string;
  sshkeys?: string;
  startdate?: string;
  startup?: string;
  tablet?: boolean | 0 | 1;
  tags?: string;
  tdf?: boolean | 0 | 1;
  template?: boolean | 0 | 1;
  tpmstate0?: string;
  'unused[n]'?: string;
  'usb[n]'?: string;
  vcpus?: number;
  vga?: string;
  'virtio[n]'?: string;
  'virtiofs[n]'?: string;
  vmgenid?: string;
  vmstate?: string;
  vmstatestorage?: string;
  watchdog?: string;
} & Record<string, unknown>;

/** POST /nodes/{node}/qemu/{vmid}/config — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidConfigPostParams = {
  acpi?: '0' | '1';
  affinity?: string;
  agent?: string;
  'allow-ksm'?: '0' | '1';
  'amd-sev'?: string;
  arch?: 'x86_64' | 'aarch64';
  args?: string;
  audio0?: string;
  autostart?: '0' | '1';
  background_delay?: `${number}`;
  balloon?: `${number}`;
  bios?: 'seabios' | 'ovmf';
  boot?: string;
  bootdisk?: string;
  cdrom?: string;
  cicustom?: string;
  cipassword?: string;
  citype?: 'configdrive2' | 'nocloud' | 'opennebula';
  ciupgrade?: '0' | '1';
  ciuser?: string;
  cores?: `${number}`;
  cpu?: string;
  cpulimit?: `${number}`;
  cpuunits?: `${number}`;
  delete?: string;
  description?: string;
  digest?: string;
  efidisk0?: string;
  force?: '0' | '1';
  freeze?: '0' | '1';
  hookscript?: string;
  'hostpci[n]'?: string;
  hotplug?: string;
  hugepages?: 'any' | '2' | '1024';
  'ide[n]'?: string;
  'import-working-storage'?: string;
  'intel-tdx'?: string;
  'ipconfig[n]'?: string;
  ivshmem?: string;
  keephugepages?: '0' | '1';
  keyboard?:
    | 'de'
    | 'de-ch'
    | 'da'
    | 'en-gb'
    | 'en-us'
    | 'es'
    | 'fi'
    | 'fr'
    | 'fr-be'
    | 'fr-ca'
    | 'fr-ch'
    | 'hu'
    | 'is'
    | 'it'
    | 'ja'
    | 'lt'
    | 'mk'
    | 'nl'
    | 'no'
    | 'pl'
    | 'pt'
    | 'pt-br'
    | 'sv'
    | 'sl'
    | 'tr';
  kvm?: '0' | '1';
  localtime?: '0' | '1';
  lock?:
    | 'backup'
    | 'clone'
    | 'create'
    | 'migrate'
    | 'rollback'
    | 'snapshot'
    | 'snapshot-delete'
    | 'suspending'
    | 'suspended';
  machine?: string;
  memory?: string;
  migrate_downtime?: `${number}`;
  migrate_speed?: `${number}`;
  name?: string;
  nameserver?: string;
  'net[n]'?: string;
  numa?: '0' | '1';
  'numa[n]'?: string;
  onboot?: '0' | '1';
  ostype?:
    | 'other'
    | 'wxp'
    | 'w2k'
    | 'w2k3'
    | 'w2k8'
    | 'wvista'
    | 'win7'
    | 'win8'
    | 'win10'
    | 'win11'
    | 'l24'
    | 'l26'
    | 'solaris';
  'parallel[n]'?: string;
  protection?: '0' | '1';
  reboot?: '0' | '1';
  revert?: string;
  rng0?: string;
  'sata[n]'?: string;
  'scsi[n]'?: string;
  scsihw?: 'lsi' | 'lsi53c810' | 'virtio-scsi-pci' | 'virtio-scsi-single' | 'megasas' | 'pvscsi';
  searchdomain?: string;
  'serial[n]'?: string;
  shares?: `${number}`;
  skiplock?: '0' | '1';
  smbios1?: string;
  smp?: `${number}`;
  sockets?: `${number}`;
  spice_enhancements?: string;
  sshkeys?: string;
  startdate?: string;
  startup?: string;
  tablet?: '0' | '1';
  tags?: string;
  tdf?: '0' | '1';
  template?: '0' | '1';
  tpmstate0?: string;
  'unused[n]'?: string;
  'usb[n]'?: string;
  vcpus?: `${number}`;
  vga?: string;
  'virtio[n]'?: string;
  'virtiofs[n]'?: string;
  vmgenid?: string;
  vmstatestorage?: string;
  watchdog?: string;
};
/** POST /nodes/{node}/qemu/{vmid}/config — `data` payload after client unwrap. */
export type NodesNodeQemuVmidConfigPostReturn = string;

/** PUT /nodes/{node}/qemu/{vmid}/config — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidConfigPutParams = {
  acpi?: '0' | '1';
  affinity?: string;
  agent?: string;
  'allow-ksm'?: '0' | '1';
  'amd-sev'?: string;
  arch?: 'x86_64' | 'aarch64';
  args?: string;
  audio0?: string;
  autostart?: '0' | '1';
  balloon?: `${number}`;
  bios?: 'seabios' | 'ovmf';
  boot?: string;
  bootdisk?: string;
  cdrom?: string;
  cicustom?: string;
  cipassword?: string;
  citype?: 'configdrive2' | 'nocloud' | 'opennebula';
  ciupgrade?: '0' | '1';
  ciuser?: string;
  cores?: `${number}`;
  cpu?: string;
  cpulimit?: `${number}`;
  cpuunits?: `${number}`;
  delete?: string;
  description?: string;
  digest?: string;
  efidisk0?: string;
  force?: '0' | '1';
  freeze?: '0' | '1';
  hookscript?: string;
  'hostpci[n]'?: string;
  hotplug?: string;
  hugepages?: 'any' | '2' | '1024';
  'ide[n]'?: string;
  'intel-tdx'?: string;
  'ipconfig[n]'?: string;
  ivshmem?: string;
  keephugepages?: '0' | '1';
  keyboard?:
    | 'de'
    | 'de-ch'
    | 'da'
    | 'en-gb'
    | 'en-us'
    | 'es'
    | 'fi'
    | 'fr'
    | 'fr-be'
    | 'fr-ca'
    | 'fr-ch'
    | 'hu'
    | 'is'
    | 'it'
    | 'ja'
    | 'lt'
    | 'mk'
    | 'nl'
    | 'no'
    | 'pl'
    | 'pt'
    | 'pt-br'
    | 'sv'
    | 'sl'
    | 'tr';
  kvm?: '0' | '1';
  localtime?: '0' | '1';
  lock?:
    | 'backup'
    | 'clone'
    | 'create'
    | 'migrate'
    | 'rollback'
    | 'snapshot'
    | 'snapshot-delete'
    | 'suspending'
    | 'suspended';
  machine?: string;
  memory?: string;
  migrate_downtime?: `${number}`;
  migrate_speed?: `${number}`;
  name?: string;
  nameserver?: string;
  'net[n]'?: string;
  numa?: '0' | '1';
  'numa[n]'?: string;
  onboot?: '0' | '1';
  ostype?:
    | 'other'
    | 'wxp'
    | 'w2k'
    | 'w2k3'
    | 'w2k8'
    | 'wvista'
    | 'win7'
    | 'win8'
    | 'win10'
    | 'win11'
    | 'l24'
    | 'l26'
    | 'solaris';
  'parallel[n]'?: string;
  protection?: '0' | '1';
  reboot?: '0' | '1';
  revert?: string;
  rng0?: string;
  'sata[n]'?: string;
  'scsi[n]'?: string;
  scsihw?: 'lsi' | 'lsi53c810' | 'virtio-scsi-pci' | 'virtio-scsi-single' | 'megasas' | 'pvscsi';
  searchdomain?: string;
  'serial[n]'?: string;
  shares?: `${number}`;
  skiplock?: '0' | '1';
  smbios1?: string;
  smp?: `${number}`;
  sockets?: `${number}`;
  spice_enhancements?: string;
  sshkeys?: string;
  startdate?: string;
  startup?: string;
  tablet?: '0' | '1';
  tags?: string;
  tdf?: '0' | '1';
  template?: '0' | '1';
  tpmstate0?: string;
  'unused[n]'?: string;
  'usb[n]'?: string;
  vcpus?: `${number}`;
  vga?: string;
  'virtio[n]'?: string;
  'virtiofs[n]'?: string;
  vmgenid?: string;
  vmstatestorage?: string;
  watchdog?: string;
};
/** PUT /nodes/{node}/qemu/{vmid}/config — `data` payload after client unwrap. */
export type NodesNodeQemuVmidConfigPutReturn = null;
