/**
 * QEMU create and update forms — declared keys only. Path identity stays out of the body.
 *
 * ⛔ NO DEFAULT IS EVER SUBSTITUTED FOR AN UNDECLARED FIELD. See qemu-props.ts's header for the
 *   "5-default PUT" this replaces: the old `shape()` sent `cores`/`memory`/`name`/`onboot`/
 *   `sockets` on every write, defaults included for whichever the declaration left out, so
 *   editing one field on an adopted VM silently reset every other to its factory value.
 */
import {
  type VmProps,
  declaredKeys,
  declaredValue,
  isManagedKey,
  wireValue,
} from './qemu-props.ts';

/**
 * Why a declared key cannot go on the wire, checked before every create and every update.
 * ★ THE SAME RULE `lxc-create-form.ts` ENFORCES FOR `Proxmox.Lxc`: a key smuggled past the types
 *   (a cast, a JS caller) is refused here rather than silently dropped or silently sent.
 */
export const formRefusals = (props: VmProps): string[] =>
  declaredKeys(props)
    .filter((key) => !isManagedKey(key))
    .map((key) => `${key}: not a config key this resource manages (vmid ${String(props.vmid)}).`);

/** The declared config, wire-spelled — every key `formRefusals` did not already refuse. */
export const form = (props: VmProps): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of declaredKeys(props)) {
    if (!isManagedKey(key)) continue;
    out[key] = wireValue(declaredValue(props, key));
  }
  return out;
};

/**
 * The create body: the declared form plus the vmid a create needs.
 * ⚠️ NO RETURN-TYPE ANNOTATION, ON PURPOSE. Annotating this `Record<string, string>` erases the
 *   object literal's own inferred shape, and with it the one thing `nodes.createNodeQemu({
 *   ...createForm(news), node: news.node })` (qemu-lifecycle.ts) needs: TypeScript only accepts a
 *   spread as satisfying `CreateNodeQemuRequest`'s required `vmid` when the spread's inferred type
 *   still carries `vmid` as a literal key, which an index-signature-only type cannot prove.
 */
export const createForm = (props: VmProps) => ({
  ...form(props),
  vmid: String(props.vmid),
});

/** The update body — identical construction to `createForm`, minus `vmid`, which PUT never sends. */
export const updateForm = form;
