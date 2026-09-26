/**
 * `netN`: comparing a declared NIC against a live one without regenerating its MAC every deploy.
 *
 * ★ PORTED FROM lxc-wire.ts's `netMaps`/`netWrite` (2026-09-26, red-team C1 on PR 297), adapted for
 *   QEMU's spelling. A container's `net0` carries a `hwaddr=` sub-key; a VM's carries the MAC as the
 *   VALUE of whichever NIC-model key is present — `virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0` — with the
 *   model itself (`e1000`, `virtio`, …) chosen by pve-qemu-server's own model list, not a fixed key
 *   name. A declaration with no MAC spells the model bare (`virtio,bridge=vmbr0,tag=20`) or with an
 *   empty value (`virtio=,bridge=vmbr0`); PVE generates one on create either way.
 * ⛔ WITHOUT THIS, A PUT OF AN UNCHANGED NIC GENERATES A NEW MAC — a new DHCP lease and a new IPv6
 *   link-local address for a guest that only had, say, its VLAN tag edited. Measured by the
 *   builder's red team against a MAC-less `net0` declaration.
 * ⚠️ OTHER SUB-KEYS (`firewall`, `link_down`, `mtu`, `queues`, `rate`, `tag`, `trunks`) COMPARE
 *   RAW, NO DEFAULTS DROPPED — that table is unverified here, unlike lxc-wire.ts's `DEFAULTS`. A
 *   difference in one is real drift and gets written, exactly as the whole-string comparison this
 *   replaces already did; only the MAC is special-cased, the minimum that fixes the measured bug.
 */
/** pve-qemu-server's own `$nic_model_list` — whichever of these is present is the MAC-bearing key. */
const NIC_MODELS = [
  'e1000',
  'e1000e',
  'i82551',
  'i82557b',
  'i82559er',
  'i82562',
  'i82801',
  'ne2k_isa',
  'ne2k_pci',
  'pcnet',
  'rtl8139',
  'virtio',
  'vmxnet3',
] as const;

/** `a=1,b=2` or a bare `a` (→ `['a', '']`) — the one-off parser this file needs, not lxc-wire's. */
const netPairs = (value: string): Map<string, string> =>
  new Map(
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part): [string, string] => {
        const at = part.indexOf('=');
        return at === -1 ? [part, ''] : [part.slice(0, at), part.slice(at + 1)];
      }),
  );

const modelKey = (map: ReadonlyMap<string, string>): string | undefined =>
  NIC_MODELS.find((model) => map.has(model));

/** The MAC-substituted comparison maps: an undeclared/blank MAC is PVE's, not drift. */
export const netMaps = (declared: string, live: string) => {
  const want = netPairs(declared);
  const have = netPairs(live);
  const wantModel = modelKey(want);
  const haveModel = modelKey(have);
  if (wantModel !== undefined && (want.get(wantModel) ?? '') === '' && haveModel !== undefined) {
    want.set(wantModel, have.get(haveModel) ?? '');
  }
  return { have, want };
};

export const sameNet = (declared: string, live: string): boolean => {
  const { have, want } = netMaps(declared, live);
  return have.size === want.size && [...want].every(([k, v]) => have.get(k) === v);
};

/** The value to PUT: the declaration, plus the live MAC when it names none. */
export const netWrite = (declared: string, live: string): string => {
  const want = netPairs(declared);
  const wantModel = modelKey(want);
  const have = netPairs(live);
  const haveModel = modelKey(have);
  if (wantModel !== undefined && (want.get(wantModel) ?? '') === '' && haveModel !== undefined) {
    want.set(wantModel, have.get(haveModel) ?? '');
  }
  return [...want].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(',');
};
