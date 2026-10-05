/** QEMU config forms and vendor guards, separated from lifecycle to keep both reviewable. */
import { createForm, updateForm } from './qemu-form.ts';
import {
  type VmAttributes,
  type VmProps,
  declaredKeys,
  declaredValue,
  isManagedKey,
  storedConfig,
  wireValue,
} from './qemu-props.ts';
import type { PveSpec } from './resource-spec.ts';
import { specGuards } from './resource-guard.ts';

export const attributesOf = (live: Record<string, unknown>, props: VmProps): VmAttributes => ({
  config: storedConfig(live),
  node: props.node,
  vmid: props.vmid,
});

/**
 * ⚠️ KEPT ONLY TO SATISFY `PveSpec`'S REQUIRED FIELD — `qemu-judge.ts`'s `judge` is what diff and
 *   reconcile actually decide by, since a plain string compare is exactly the bug C1 found (it
 *   never matches the "new disk" or MAC-less spellings a declaration may use).
 */
const matches = (attributes: VmAttributes, props: VmProps) =>
  declaredKeys(props)
    .filter(isManagedKey)
    .every((key) => attributes.config[key] === wireValue(declaredValue(props, key)));

export const spec = {
  attributes: attributesOf,
  collection: (props: VmProps) => `nodes/${props.node}/qemu`,
  createForm,
  endpoint: {
    create: 'pve:POST /nodes/{node}/qemu',
    update: 'pve:PUT /nodes/{node}/qemu/{vmid}/config',
  },
  matches,
  path: (props: VmProps) => `nodes/${props.node}/qemu/${String(props.vmid)}/config`,
  updateForm,
} satisfies PveSpec<VmProps, VmAttributes>;

export const { guardCreate, guardUpdate } = specGuards(spec);
