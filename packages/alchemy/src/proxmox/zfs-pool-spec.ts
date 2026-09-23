/**
 * The `PveSpec` for `Proxmox.ZfsPool`: where a pool lives, what its GET reports, and the vendor
 * endpoint its create form is checked against.
 *
 * ★ SPLIT OUT OF zfs-pool.ts TO KEEP THAT FILE UNDER THE 250-LINE CAP, and the seam is the same
 *   one metric-server-form.ts and zfs-pool-write.ts already cut on: zfs-pool.ts answers "what is
 *   a zpool and when has it changed", this file answers "what PVE's own GET/{node}/disks/zfs
 *   collection and item say, read into that shape". `leafDevices` moved with `spec` because it
 *   exists for exactly one field of `spec.attributes` and nothing else in this package calls it.
 *
 * ⚠️ THE `import type` BACK TO zfs-pool.ts IS A CYCLE ON PAPER ONLY — type-only, erased before
 *   anything runs, so the resource's public shape stays in the file that declares the resource.
 *   Same reasoning as zfs-pool-write.ts.
 */
import type { PveSpec } from './resource.ts';
import { text } from './values.ts';
import { createForm, zfsPoolEndpoint } from './zfs-pool-write.ts';
import type { ZfsPoolAttributes, ZfsPoolProps } from './zfs-pool.ts';

/**
 * The device paths at the bottom of PVE's vdev tree, in the order ZFS reports them.
 *
 * ⚠️ "NO CHILDREN" IS THE LEAF TEST, AND IT IS NOT A GUESS — MEASURED in the node's `preparetree`,
 *   which sets `leaf` to 0 when there are children and 1 otherwise. Reading the flag would work
 *   equally well; recursing on `children` needs no second field to be present and is what makes
 *   nested sections (mirrors inside a raid10, `spares`, `cache`) flatten correctly.
 */
export const leafDevices = (children: unknown): string[] =>
  Array.isArray(children)
    ? children.flatMap((entry: unknown) => {
        const vdev = entry as { children?: unknown; name?: unknown };
        const nested = leafDevices(vdev.children);
        return nested.length > 0 ? nested : [text(vdev.name)].filter((name) => name !== '');
      })
    : [];

export const spec: PveSpec<ZfsPoolProps, ZfsPoolAttributes> = {
  /**
   * ⚠️ `scan`, `status` AND `action` ARE DELIBERATELY NOT ATTRIBUTES. All three are advisory
   *   strings ZFS rewrites on its own — `scan` on every scrub, the other two as feature flags and
   *   faults come and go — so keeping them would rewrite this resource's state row for reasons no
   *   declaration caused. Same reasoning as `digest` in storage.ts.
   */
  attributes: (live, props) => {
    // ⚠️ A detail answer with no `name` is not a pool. `name` is non-optional in PVE's schema, so
    //   this is a shape check rather than a default — and "absent" is the honest reading of a
    //   reply that does not describe the object that was asked for.
    if (text(live['name']) === '') return undefined;
    return {
      devices: leafDevices(live['children']).join(','),
      errors: text(live['errors'], 'unknown'),
      name: props.name,
      node: props.node,
      state: text(live['state'], 'unknown'),
    };
  },
  collection: (props) => `nodes/${props.node}/disks/zfs`,
  createForm,
  /** ★ A function of props, not the constant — see the ★ on `zfsPoolEndpoint` (zfs-pool-write.ts). */
  endpoint: zfsPoolEndpoint,
  /**
   * ⛔ IT ALWAYS ANSWERS TRUE, AND THAT IS THE POINT OF THIS FILE. A pool that is there under the
   *   declared name on the declared node IS the declaration, because there is nothing else the two
   *   can be compared on: every create parameter is write-only (see the ⛔ in zfs-pool.ts's header)
   *   and everything the read does return is telemetry that moves by itself. So declaring what is
   *   live plans as `noop` — the only honest answer available, and the one the live cluster needs:
   *   `rpool` exists on node-b, node-c and node-d with nothing about its construction readable.
   *   ⛔ ANYTHING ADDED HERE IS A REPLACE, NOT AN UPDATE. `updateForm` is omitted because PVE has
   *     no PUT, so `resource.ts` turns a false into `{action:'replace'}` — delete then create — on
   *     a family whose delete is `zpool destroy`. A comparison added here would be one plan away
   *     from destroying a pool over a field it cannot even read back. If a future PVE grows a PUT,
   *     add `updateForm` FIRST and only then consider comparing what that PUT accepts.
   */
  matches: () => true,
  path: (props) => `nodes/${props.node}/disks/zfs/${props.name}`,
};
