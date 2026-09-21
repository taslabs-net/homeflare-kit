/**
 * One shape for every PVE object, so the provider can cover Proxmox rather than a corner of it.
 *
 * ⛔ THE ALTERNATIVE IS TWENTY COPIES OF THE SAME 130 LINES. Proxmox exposes LXC, QEMU, storage,
 *   pools, users, groups, roles, ACLs, API tokens, SDN zones/vnets/subnets, firewall rules and
 *   groups, HA resources, backup and replication jobs, metric servers and notification targets.
 *   Each is the same four operations over a different path and a different form body. Written by
 *   hand, resource number six is where someone quietly drops the read-back or the isResolved guard
 *   and nobody notices until a plan lies.
 *
 * ★ SO THE FOUR OPERATIONS LIVE HERE, ONCE, AND A RESOURCE DECLARES ONLY WHAT IS DIFFERENT:
 *   where it lives, how to recognise it, and which fields are mutable. A new PVE object should be
 *   thirty lines, not a hundred and thirty.
 *
 * ⚠️ EVERY PVE ANSWER IS WRAPPED IN `{"data": ...}` AND A FAILED CALL CAN STILL BE HTTP 200 with
 *   `{"data": null}`. That is why `reconcile` below READS BACK and refuses when the object is still
 *   absent, rather than trusting a status code — see the ⛔ in that function.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { pve } from './client.ts';
import type { ApiTarget, PbsTarget, PveRole, PveTarget } from './credentials.ts';
import { formToSend } from './update-guard.ts';

/**
 * ★ WHY SEVERAL FAMILIES HERE DECLARE `defaultRemovalPolicy: 'retain'`, WRITTEN ONCE.
 *
 *   Alchemy's own convention: a few resource types default to retain "because their contents are
 *   irreplaceable" — `GitHub.Repository` and `Cloudflare.Zone` do — and those opt into deletion
 *   with `destroy()`. `retain` means the engine SKIPS `provider.delete` entirely when a resource
 *   is orphaned or destroyed: the state row is dropped, the cluster object lives on.
 *
 *   So the PVE families whose contents cannot be rebuilt from a line of TypeScript — CephOsd,
 *   CephPool, CephFs, CephDaemon, ZfsPool, Storage, NodeNetwork — carry that default. Their
 *   `delete` is FULLY IMPLEMENTED and runs the moment a caller opts in with
 *   `.pipe(RemovalPolicy.destroy())`. This is deliberately the Terraform `prevent_destroy` shape
 *   rather than a stubbed-out operation: a `delete` that silently does nothing lies to whoever is
 *   reading the plan, and the lie is discovered at the worst possible time.
 *
 * ⚠️ THE POLICY IS A DECORATION, NOT A PROP, so changing it produces NO DIFF — the resource plans
 *   as a noop and the deploy re-commits the row's policy in place. A policy change therefore takes
 *   effect from the very next deploy even though the plan shows nothing.
 */

/**
 * ⛔ A RESOURCE IS PINNED TO ITS PRODUCT; ONLY THE FACTORY TAKES EITHER. The two hosts are the same
 *   two strings, so without a required discriminant TypeScript would accept a PBS host wherever a
 *   PVE one belongs — silently, with every call 401ing and `read` folding that into "absent". The
 *   whole argument is on `scheme` in credentials.ts.
 */
/**
 * ★ WHAT EVERY OPERATION IN THIS PACKAGE NEEDS FROM THE RUNTIME, NAMED ONCE.
 *
 *   `HttpClient`, for both halves of every call: the credential is minted from OpenBao's HTTP API
 *   and the PVE call goes through the same client. That is what Alchemy's own providers do
 *   (src/Hetzner/Providers.ts builds on `FetchHttpClient.layer`, and there is no bare `fetch` in
 *   its Docker, Kubernetes or GitHub providers).
 * ★ `ChildProcessSpawner` WAS HERE UNTIL 2026-09-14, while the mint shelled out to `bao`. The HTTP
 *   client replaced that (credentials.ts), so the requirement went with it.
 *
 * ⚠️ SPELLED OUT AT EACH OF THE FORTY-ODD RESOURCES this would be a union nobody keeps in step —
 *   one file left on the old shape is a type error at the stack, far from the cause. Named here,
 *   adding a third service later is one edit.
 */
export type PveRequirements = HttpClient.HttpClient;

export type WithTarget = { target: PveTarget };
export type WithPbsTarget = { target: PbsTarget };
export type WithApiTarget = { target: ApiTarget };

export type PveSpec<Props extends WithApiTarget, Attributes> = {
  /** `pools/house`, `nodes/n2/lxc/101` — where ONE object is read, updated and deleted. */
  readonly path: (props: Props) => string;
  /** `pools`, `nodes/n2/lxc` — where a NEW one is POSTed. */
  readonly collection: (props: Props) => string;
  /** Live JSON to attributes. Returning undefined means "this is not really there". */
  readonly attributes: (live: Record<string, unknown>, props: Props) => Attributes | undefined;
  /** The form PVE wants on create. ⚠️ PVE takes form encoding, not JSON. */
  readonly createForm: (props: Props) => Record<string, string>;
  /**
   * The form for an update, or undefined when the object has no mutable fields.
   *
   * ⚠️ SOME PVE OBJECTS CANNOT BE UPDATED AT ALL. Returning undefined makes a changed prop a
   *   REPLACE rather than a silent no-op, which is the honest answer for an immutable object.
   */
  readonly updateForm?: (props: Props) => Record<string, string>;
  /** True when live already matches props. Decides noop vs update. */
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  /**
   * Which lease reads this family. Defaults to `read`, the 3600s auditor-shaped one.
   *
   * ⛔ THREE FAMILIES SET THIS TO `provision`, AND THE FAILURE IT AVOIDS IS SILENT. PVE gates some
   *   SINGLE-OBJECT reads on the allocate privilege rather than the audit one — `/storage/{id}`,
   *   `/cluster/sdn/zones/{zone}`, `/cluster/sdn/vnets/{vnet}` — while their COLLECTION reads
   *   accept audit, so nothing looks wrong until a resource reads one object. `read` below folds
   *   every failure into `undefined`, right for a 404 and wrong for a 403, so the plan says create
   *   and PVE answers that the object already exists. Measured both ways on `local`, and written
   *   up with the alternative that was rejected, in docs/privileges.md.
   */
  readonly readRole?: PveRole;
};

export const pveOperations = <Props extends WithApiTarget, Attributes>(
  spec: PveSpec<Props, Attributes>,
) => {
  /** The live object, or undefined. ⚠️ A 404 is an ANSWER here, not a failure. */
  const read = (props: Props) =>
    pve<Record<string, unknown>>(
      props.target,
      spec.readRole ?? 'read',
      'GET',
      spec.path(props),
    ).pipe(
      Effect.map((data) => (data === undefined ? undefined : spec.attributes(data, props))),
      Effect.orElseSucceed(() => undefined),
    );

  return {
    read,

    // ⚠️ `Input<Props>`, NOT `Props`. At plan time a prop can still be an unresolved Output or
    //   Config; `isResolved` is the narrowing, so the parameter has to admit the wider type or
    //   every caller casts — and a cast here would be a lie about what plan actually has.
    diff: (news: Input<Props>, output: Attributes | undefined) =>
      Effect.gen(function* () {
        // ⚠️ A prop can still be an unresolved Output at plan time. Alchemy's own providers guard
        //   with isResolved and skip rather than guess; comparing a placeholder to a live value
        //   reports an update nobody asked for.
        if (output === undefined || !isResolved(news)) return undefined;
        const live = yield* read(news);
        // ⚠️ `update`, NOT `create` — Alchemy's Diff admits only noop/update/replace. An object
        //   Alchemy has state for but the cluster does not is drift, and reconcile repairs it.
        if (live === undefined) return { action: 'update' } as const;
        if (spec.matches(live, news)) return { action: 'noop' } as const;
        // An object with no update path cannot be edited in place; say replace and mean it.
        return spec.updateForm === undefined
          ? ({ action: 'replace' } as const)
          : ({ action: 'update' } as const);
      }),

    reconcile: (news: Props) =>
      Effect.gen(function* () {
        const live = yield* read(news);
        if (live === undefined) {
          yield* pve(
            news.target,
            'provision',
            'POST',
            spec.collection(news),
            spec.createForm(news),
          );
        } else if (spec.updateForm !== undefined) {
          /**
           * ⛔ ADOPTING AN OBJECT THAT ALREADY MATCHES MUST NOT WRITE TO IT, AND WITHOUT THE
           *   `matches` GUARD IT DID. Alchemy's `adopted` action is NOT a read: Apply.ts routes it
           *   down the same branch as `update` and calls `reconcile` (Apply.ts:980 and :1045). So
           *   the first time a declaration names an object Alchemy has no state for — which is
           *   exactly what adopting the live estate means — reconcile runs, finds it present, and
           *   fell through to this PUT.
           *
           *   For most families that was a pointless write-back of identical values. For
           *   `Proxmox.NodeNetwork` it is worse than pointless: a PUT under `/nodes/{node}/network`
           *   STAGES a change into `/etc/network/interfaces.new`, so merely adopting the interface
           *   a node already has would leave that node with a pending network change waiting for an
           *   apply — on a cluster whose Ceph traffic rides vmbr1.11. Adoption has to be free.
           *
           * ★ SO THE CONDITION IS THE SAME PREDICATE `diff` USES. If `matches` is true the object
           *   already says what the declaration says, and there is nothing to write — by
           *   definition, since every field this provider manages is a field `matches` compares.
           *   A field deliberately left OUT of `matches` is one this resource does not manage, so
           *   its drift is not this provider's to repair.
           *
           * ★ THE PREDICATE LIVES IN update-guard.ts NOW, with the ⚠️ on why an empty form is not a
           *   write either, because CephPool and PbsDatastore write their own reconcile and need
           *   the same one — CephPool did not have it (see that file).
           */
          const form = formToSend(spec.matches, live, news, spec.updateForm(news));
          if (form !== undefined) {
            yield* pve(news.target, 'provision', 'PUT', spec.path(news), form);
          }
        }
        const after = yield* read(news);
        if (after === undefined) {
          /**
           * ⛔ REFUSE RATHER THAN RETURN THE PROPS AS THOUGH THEY LANDED. PVE answers 200 with
           *   `{"data": null}` on several endpoints, so "no error" is not evidence of a write. A
           *   provider that returned its own inputs here would record state for an object that does
           *   not exist, and the next plan would read `noop` over the gap.
           */
          return yield* Effect.die(
            new Error(
              `${spec.path(news)}: the write returned no error but the object is still absent. ` +
                'PVE wraps every answer in {"data":...} and can report success on a call that did ' +
                'nothing -- read back rather than trusting the status code.',
            ),
          );
        }
        return after;
      }),

    /**
     * ⚠️ PVE REFUSES TO DELETE THINGS THAT ARE STILL IN USE — a pool holding guests, a storage with
     *   volumes. That refusal is the cluster declining to orphan something because a line left a
     *   file, so it is surfaced as-is rather than retried with a force flag.
     */
    destroy: (olds: Props) => pve(olds.target, 'provision', 'DELETE', spec.path(olds)),
  };
};

/**
 * The five provider handlers for a spec'd PVE object, wired once.
 *
 * ⛔ THIS BLOCK WAS WRITTEN TEN TIMES BEFORE IT WAS EXTRACTED, and every copy was character for
 *   character identical apart from its comments: `list` answering empty, and four handlers whose
 *   entire body was `yield* ops.<same name>(<same argument>)`. Ten copies of a delegation is ten
 *   chances to delegate to the wrong one — `ops.read(olds)` inside `reconcile` typechecks, returns
 *   a plausible value, and turns every deploy into a no-op that reports success.
 *
 * ★ IT TAKES THE SPEC, NOT THE OPERATIONS, so a resource declares its four spec functions and
 *   stops. `pveOperations` stays exported for an object that genuinely needs a handler of its own;
 *   nothing in this package does yet, and the day one does it should be visibly different from the
 *   ten that are not.
 *
 * ⛔ IT STOPS AT THE HANDLERS AND DOES NOT RETURN THE LAYER, AND THAT IS NOT AN OVERSIGHT — it was
 *   written the other way first and reverted. Wrapping `Provider.effect(cls, …)` here means naming
 *   the resource class generically, and Alchemy's `Props<R>` and `R["Attributes"]` are not the
 *   plain `Props` and `Attributes` this spec is written against: `Attributes` comes back as
 *   `Attributes & AttrOutput<Attributes["Attributes"]>`. Against a free type variable TypeScript
 *   cannot prove those line up — "could be instantiated with a different subtype" — so the only
 *   way to compile a Layer-returning version is a cast, and a cast is a LIE ABOUT WHETHER THE
 *   HANDLERS MATCH THE RESOURCE, which is the one thing the call site exists to check. Leaving
 *   `Cls.Provider.of(...)` in each file keeps that check where the types are concrete and real.
 *   One line per resource is the price of it, and it is worth paying.
 *
 * ⚠️ `list` IS OPTIONAL IN `ProviderServiceInput` AND IS PASSED ANYWAY. An empty list is a claim —
 *   this provider adopts nothing — and it is made here for every PVE object at once, because the
 *   reasoning is identical for all of them: every PVE index endpoint answers with the whole
 *   cluster's objects, PVE's own built-ins included. `GET /pools` returns pools a human made years
 *   ago; `GET /access/roles` returns `Administrator`. Returning any of them would invite Alchemy to
 *   adopt an object it never created, and therefore one day to narrow or delete it. Adoption stays
 *   an explicit act. A resource with a reason to differ passes its own `list` and says why.
 */
export const pveHandlers = <Props extends WithApiTarget, Attributes extends object>(
  spec: PveSpec<Props, Attributes>,
) => {
  const ops = pveOperations(spec);
  return {
    list: () => Effect.succeed([]),
    read: ({ olds }: { olds: Props }) => ops.read(olds),
    diff: ({ news, output }: { news: Input<Props>; output: Attributes | undefined }) =>
      ops.diff(news, output),
    reconcile: ({ news }: { news: Props }) => ops.reconcile(news),
    delete: ({ olds }: { olds: Props }) => ops.destroy(olds),
  };
};
