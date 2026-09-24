/** QEMU create and update forms. Path identity stays out of the body. */
import type { VmProps } from './qemu.ts';

/** Fields both create and update send. `net0` is optional and is not compared. */
export const shape = (props: VmProps) => ({
  cores: String(props.cores ?? 1),
  memory: String(props.memory ?? 512),
  name: props.name ?? `vm${String(props.vmid)}`,
  onboot: props.onboot === true ? '1' : '0',
  sockets: String(props.sockets ?? 1),
  ...(props.net0 === undefined ? {} : { net0: props.net0 }),
});

/** ★ Exported so the constraint proof can run the REAL create form, not a retyped copy of it. */
export const createForm = (props: VmProps) => ({ ...shape(props), vmid: String(props.vmid) });
