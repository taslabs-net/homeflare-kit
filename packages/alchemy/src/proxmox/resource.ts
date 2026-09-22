/**
 * The four operations every PVE object shares, and the five handlers that wire them to Alchemy.
 *
 * ★ THE SHAPE THEY READ IS `PveSpec`, IN resource-spec.ts, WITH THE ARGUMENT FOR IT. This file was
 *   one file until 2026-09-22, when the vendor-constraint guard took it past the 250-line cap; the
 *   split is by what a reader is doing — declaring an object, or changing how every object is
 *   written — and the types are re-exported below so no importer moved.
 *
 * ⚠️ EVERY PVE ANSWER IS WRAPPED IN `{"data": ...}` AND A FAILED CALL CAN STILL BE HTTP 200 with
 *   `{"data": null}`. That is why `reconcile` below READS BACK and refuses when the object is still
 *   absent, rather than trusting a status code — see the ⛔ in that function.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import { pve } from './client.ts';
import { guardForm } from './constraint-guard.ts';
import type { PveSpec, WithApiTarget } from './resource-spec.ts';
import { formToSend } from './update-guard.ts';

export type {
  PveRequirements,
  PveSpec,
  WithApiTarget,
  WithPbsTarget,
  WithTarget,
} from './resource-spec.ts';

export const pveOperations = <Props extends WithApiTarget, Attributes>(
  spec: PveSpec<Props, Attributes>,
) => {
  /**
   * Both forms against their own endpoint's table.
   *
   * ⚠️ PRESENCE IS CHECKED ON CREATE ONLY. An update form is deliberately partial — `formToSend`
   *   sends what changed — so requiring the vendor's required parameters there would refuse every
   *   ordinary edit. Value rules (length, range, enum, pattern) apply to both.
   */
  const guardForms = (props: Props) =>
    Effect.gen(function* () {
      /**
       * ⛔ THE FORM IS BUILT ONLY WHEN THERE IS A TABLE TO CHECK IT AGAINST. Calling
       *   `spec.createForm` unconditionally would run every family's form builder on every diff,
       *   including the fifteen that declare no `endpoint` — work nobody asked for, and a new way
       *   for a builder that throws on an update-only path to break a plan it never touched.
       */
      const create = spec.endpoint?.create;
      if (create !== undefined) yield* guardForm(create, spec.createForm(props), true);
      const update = spec.endpoint?.update;
      if (update === undefined) return;
      const form = spec.updateForm?.(props);
      if (form !== undefined) yield* guardForm(update, form, false);
    });

  /** The live object, or undefined. ⚠️ A 404 and `{"data": null}` are ANSWERS, not failures. */
  const read = (props: Props) =>
    pve<Record<string, unknown>>(
      props.target,
      spec.readRole ?? 'read',
      'GET',
      spec.path(props),
    ).pipe(
      Effect.map((data) => (data == null ? undefined : spec.attributes(data, props))),
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
        if (!isResolved(news)) return undefined;
        /**
         * ⛔ THE VENDOR CHECK RUNS BEFORE THE `output === undefined` RETURN, AND THE ORDER IS THE
         *   WHOLE FIX. `output === undefined` IS the resource Alchemy has no state for — the
         *   create. Checking after it would leave exactly the case that failed on 2026-09-22
         *   unchecked, and the refusal would arrive from the server, half a deploy in.
         */
        yield* guardForms(news);
        if (output === undefined) return undefined;
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
        // ⚠️ CHECKED AGAIN HERE, AND NOT BECAUSE `diff` IS UNTRUSTED. `reconcile` also runs for an
        //   ADOPTED row, whose diff answer Alchemy discards (verify/fake-engine.ts records it), and
        //   a family that writes its own reconcile bypasses the one above entirely.
        yield* guardForms(news);
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
           *   apply — on a cluster whose Ceph traffic rides vmbr1.42. Adoption has to be free.
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
