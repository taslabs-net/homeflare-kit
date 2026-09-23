/**
 * Generated pve-manager API types for `/nodes/node/qemu` — DO NOT EDIT BY HAND.
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
 */

/** GET /nodes/{node}/qemu — form/query parameters (path segments omitted). */
export type NodesNodeQemuGetParams = { full?: '0' | '1' };
/** GET /nodes/{node}/qemu — `data` payload after client unwrap. */
export type NodesNodeQemuGetReturn = readonly ({
  cpu?: number;
  cpus?: number;
  diskread?: number;
  diskwrite?: number;
  lock?: string;
  maxdisk?: number;
  maxmem?: number;
  mem?: number;
  memhost?: number;
  name?: string;
  netin?: number;
  netout?: number;
  pid?: number;
  pressurecpufull?: number;
  pressurecpusome?: number;
  pressureiofull?: number;
  pressureiosome?: number;
  pressurememoryfull?: number;
  pressurememorysome?: number;
  qmpstatus?: string;
  'running-machine'?: string;
  'running-qemu'?: string;
  serial?: boolean | 0 | 1;
  status: 'stopped' | 'running';
  tags?: string;
  template?: boolean | 0 | 1;
  uptime?: number;
  vmid: number;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/qemu — form/query parameters (path segments omitted). */
export type NodesNodeQemuPostParams = {
  acpi?: '0' | '1';
  affinity?: string;
  agent?: string;
  'allow-ksm'?: '0' | '1';
  'amd-sev'?: string;
  arch?: 'x86_64' | 'aarch64';
  archive?: string;
  args?: string;
  audio0?: string;
  autostart?: '0' | '1';
  balloon?: `${number}`;
  bios?: 'seabios' | 'ovmf';
  boot?: string;
  bootdisk?: string;
  bwlimit?: `${number}`;
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
  description?: string;
  efidisk0?: string;
  force?: '0' | '1';
  freeze?: '0' | '1';
  'ha-managed'?: '0' | '1';
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
  'live-restore'?: '0' | '1';
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
  pool?: string;
  protection?: '0' | '1';
  reboot?: '0' | '1';
  rng0?: string;
  'sata[n]'?: string;
  'scsi[n]'?: string;
  scsihw?: 'lsi' | 'lsi53c810' | 'virtio-scsi-pci' | 'virtio-scsi-single' | 'megasas' | 'pvscsi';
  searchdomain?: string;
  'serial[n]'?: string;
  shares?: `${number}`;
  smbios1?: string;
  smp?: `${number}`;
  sockets?: `${number}`;
  spice_enhancements?: string;
  sshkeys?: string;
  start?: '0' | '1';
  startdate?: string;
  startup?: string;
  storage?: string;
  tablet?: '0' | '1';
  tags?: string;
  tdf?: '0' | '1';
  template?: '0' | '1';
  tpmstate0?: string;
  unique?: '0' | '1';
  'unused[n]'?: string;
  'usb[n]'?: string;
  vcpus?: `${number}`;
  vga?: string;
  'virtio[n]'?: string;
  'virtiofs[n]'?: string;
  vmgenid?: string;
  vmid: `${number}`;
  vmstatestorage?: string;
  watchdog?: string;
};
/** POST /nodes/{node}/qemu — `data` payload after client unwrap. */
export type NodesNodeQemuPostReturn = string;

/** GET /nodes/{node}/qemu/{vmid} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** DELETE /nodes/{node}/qemu/{vmid} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidDeleteParams = {
  'destroy-unreferenced-disks'?: '0' | '1';
  purge?: '0' | '1';
  skiplock?: '0' | '1';
};
/** DELETE /nodes/{node}/qemu/{vmid} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidDeleteReturn = string;
