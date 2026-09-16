/**
 * `Proxmox.HaResource` — a guest's HA membership, declared.
 *
 * ★ WITHOUT ONE OF THESE, EVERY GUEST THIS PACKAGE DECLARES IS PINNED TO THE NODE THE LINE NAMED
 *   AND DIES WITH IT. The target is a three-node quorate cluster holding zero HA resources, so
 *   `node` in `LxcProps` is the whole of a container's availability story: lose that node and the
 *   container is simply gone until a person notices. Declaring a guest without declaring its HA
 *   membership is half a declaration, which is why this lives beside `lxc.ts` rather than in a
 *   runbook somebody reads after an outage.
 *
 * ⚠️ `state` READS LIKE STATUS AND IS CONFIGURATION. `started | stopped | disabled | ignored` is
 *   the state the CRM is ASKED for; a line in the HA config file, not a reading off the cluster,
 *   so it is a prop and it is compared. `LxcAttributes.status` is the opposite case — reported,
 *   never declared — and confusing the two inverts the meaning: `state: 'stopped'` here says "HA
 *   should hold this guest stopped and still relocate it on node failure", not "it is stopped".
 *
 * ⛔ AND YET IT MOVES POWER, WHICH IS THE ONE PLACE THIS PACKAGE'S "PLANS DO NOT START THINGS" RULE
 *   BENDS. `lxc.ts` and `qemu.ts` refuse to own power state precisely so a deploy is not a
 *   maintenance window — but the CRM acts on whatever this file says. The default `started` will
 *   BOOT a stopped guest within seconds of the write, and `stopped` will SHUT DOWN a running one.
 *   There is no way to declare HA membership without declaring intent, so the intent is at least
 *   explicit and diffable here; read a plan that touches `state` as a plan that touches uptime.
 *
 * ⛔ `sid` CARRIES ITS TYPE PREFIX — `ct:101`, `vm:100` — AND READ ANSWERS IN THE PREFIXED FORM.
 *   POST also takes the bare `101` shortcut; taking it would leave a resource keyed on a spelling
 *   PVE never returns, and every plan comparing `101` against `ct:101`. So the prefixed form is
 *   required here and it is what goes into the path.
 *   ⚠️ EDITING `sid` IN PLACE ORPHANS THE OLD MEMBERSHIP. `diff` reads the NEW path, finds nothing
 *     and calls that drift, so reconcile creates the new entry and the old one stays under HA with
 *     nothing declaring it. Retire the declaration and add a second one instead of renaming.
 *
 * ⛔ MEASURED ON PVE 9.2: `/cluster/ha/groups` ANSWERS HTTP 500 — groups were removed in PVE 9,
 *   even though the published API schema still documents the endpoint AND a `group` parameter on
 *   this very resource. Nothing here sends `group`. The successor is `/cluster/ha/rules`
 *   (node-affinity and resource-affinity) and that is the next family to add; do not port the old
 *   groups endpoint back just because the docs still describe it.
 *
 * ⚠️ RECONCILE NEEDS `Sys.Console` ON `/`, WHICH `LXCProvisioner` DOES NOT HOLD. Read and diff are
 *   fine — `GET /cluster/ha/resources/{sid}` checks `Sys.Audit`, which the role already has — while
 *   POST, PUT and DELETE all check `Sys.Console` on `/` and will answer "Permission check failed
 *   (/, Sys.Console)" until the role is widened. Widen it knowingly: `Sys.Console` is also what
 *   opens a root shell on every node (`/nodes/{node}/vncshell`, `termproxy`), so granting it to the
 *   provision credential buys HA membership at the price of node console access. A separate role
 *   for HA writes is the narrower answer if that trade is not wanted.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { num } from './values.ts';

/**
 * The requested states this provider admits.
 *
 * ⚠️ `enabled` IS DELIBERATELY ABSENT. PVE accepts it and documents it as an alias for `started`,
 *   which means a resource declared as `enabled` can be read back as `started` — and `matches`
 *   would then report an update on every plan, forever, over a difference in spelling. One spelling
 *   per state is the only version of this that settles.
 */
export type HaState = 'started' | 'stopped' | 'disabled' | 'ignored';

export interface HaResourceProps extends WithTarget {
  /** ⛔ PREFIXED AND CLUSTER-WIDE: `ct:101`, `vm:100`. Changing it is a different object. */
  sid: string;
  /** What the CRM should aim for. Defaults to `started`, PVE's own default. */
  state?: HaState;
  /** Free text shown in the HA panel. Max 4096 characters. */
  comment?: string;
  /** Restart tries on the SAME node before the manager gives up and relocates. Default 1. */
  max_restart?: number;
  /** Relocation tries before the resource is left in `error`. Default 1. */
  max_relocate?: number;
}

export interface HaResourceAttributes {
  /** As PVE returns it, prefix included. */
  sid: string;
  /** `ct` | `vm`. Implied by the prefix, reported so a plan can say what is being protected. */
  type: string;
  /**
   * ⚠️ TYPED `string`, NOT `HaState`, because this is whatever the config file holds — including an
   *   `enabled` a person wrote in the UI. Narrowing it here would be a claim about someone else's
   *   edit rather than a report of it.
   */
  state: string;
  comment: string;
  max_restart: number;
  max_relocate: number;
}

export interface ProxmoxHaResource extends Resource<
  'Proxmox.HaResource',
  HaResourceProps,
  HaResourceAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxHaResource = Resource<ProxmoxHaResource>('Proxmox.HaResource');

/** `ct:101` -> `ct`. ⚠️ `?? ''` because noUncheckedIndexedAccess types `split()[0]` as optional. */
const kind = (sid: string) => sid.split(':')[0] ?? '';

/**
 * ⚠️ NO `type` IN EITHER FORM, ON PURPOSE. The prefix in `sid` already names it on create, and PUT
 *   does not accept `type` at all — sending it on create only would make the two shapes diverge for
 *   no gain, and sending it on update is a parameter-verification failure.
 */
const shape = (props: HaResourceProps) => ({
  comment: props.comment ?? '',
  max_relocate: String(props.max_relocate ?? 1),
  max_restart: String(props.max_restart ?? 1),
  state: props.state ?? 'started',
});

const handlers = pveHandlers<HaResourceProps, HaResourceAttributes>({
  attributes: (live, props) => ({
    comment: typeof live['comment'] === 'string' ? live['comment'] : '',
    max_relocate: num(live['max_relocate'], 1),
    max_restart: num(live['max_restart'], 1),
    sid: typeof live['sid'] === 'string' ? live['sid'] : props.sid,
    state: typeof live['state'] === 'string' ? live['state'] : 'started',
    type: typeof live['type'] === 'string' ? live['type'] : kind(props.sid),
  }),
  /**
   * ⚠️ CLUSTER-SCOPED, SO THERE IS NO NODE IN THE PATH — and that is the point of the object. The
   *   guest's node is where it happens to run now; this resource is the statement that it may run
   *   somewhere else tomorrow.
   */
  collection: () => 'cluster/ha/resources',
  createForm: (props) => ({ ...shape(props), sid: props.sid }),
  /**
   * ⚠️ `digest` IS NOT COMPARED AND IS NOT AN ATTRIBUTE. It changes whenever ANY line of the HA
   *   config changes, including one written for a different guest, so diffing it would report an
   *   update on this resource because somebody else edited theirs.
   * ⚠️ `sid` AND `type` ARE NOT COMPARED EITHER: sid is the path, so a change there is a different
   *   object, and type is create-only — it is read back from the prefix, never edited.
   */
  matches: (attributes, props) =>
    attributes.state === (props.state ?? 'started') &&
    attributes.comment === (props.comment ?? '') &&
    attributes.max_restart === (props.max_restart ?? 1) &&
    attributes.max_relocate === (props.max_relocate ?? 1),
  /**
   * ⚠️ THE COLON GOES INTO THE URL RAW. RFC 3986 allows `:` inside a path segment and PVE matches
   *   the sid as one segment, so no `encodeURIComponent` here; percent-encoding it would make the
   *   request depend on a proxy normalising `%3A` back before the dispatcher sees it.
   */
  path: (props) => `cluster/ha/resources/${props.sid}`,
  updateForm: shape,
});

/**
* ⛔ Empty for the same reason as every other resource here: adoption must be explicit.
*   `GET /cluster/ha/resources` would hand back every guest an operator has ever put under
*   HA, and adopting those means one day deleting them.
 
 *
* ⛔ DELETE DEFAULTS TO `purge=1` AND THE FACTORY SENDS NO FORM, SO THAT DEFAULT APPLIES:
*   PVE strips the sid out of every HA rule referencing it and DELETES a rule that had no
*   other member. Destroying an HA membership can therefore take an affinity rule with it,
*   which matters once the rules family lands.
* ⚠️ It does NOT stop or remove the guest. The container keeps running exactly where it is,
*   only unmanaged — so removing this resource is how a guest is handed back to its node,
*   not how it is decommissioned.
 
 */
export const ProxmoxHaResourceProvider = () =>
  Provider.effect(ProxmoxHaResource, Effect.succeed(ProxmoxHaResource.Provider.of(handlers)));
