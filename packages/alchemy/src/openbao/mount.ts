/**
 * An OpenBao secrets engine mount — path, type, description and lease TTLs.
 *
 * ⛔ NO SECRET IN PROPS OR ATTRIBUTES — see policy.ts for why. This declares mount
 *   SHAPE only: names, types, TTL strings and a digest. KV values and CA material live
 *   in OpenBao, not Alchemy state.
 *
 * ★ `defaultRemovalPolicy: 'retain'` — disabling a mount destroys every secret under it.
 *   Opt in with `.pipe(RemovalPolicy.destroy())`; see resource.ts in house/proxmox.
 *
 * ★ REPLACE SEMANTICS (audited 2026-09-21, see src/openbao/REPLACE.md):
 *   · `type` changed → plans `replace`, and the APPLY FAILS, destroying nothing: the new
 *     generation's path is the old one's, still occupied, so its reconcile dies "type is
 *     immutable" before any write (mount-reconcile.ts). Change a type by hand. ⛔ Not `deleteFirst`
 *     on purpose — under `destroy` that would disable the mount, every secret with it, on a typo.
 *   · `path` changed → FAILS the plan unless `remountFrom` names the old path, which is an
 *     in-place `update` that moves the mount and its data (mount-move.ts). It used to be an
 *     `update` that enabled an EMPTY mount at the new path.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { claimFor } from '../ownership/adopt.ts';
import { ownedRead } from '../ownership/probe.ts';
import { noteResume } from '../ownership/resume.ts';
import { type BaoMountAttributes, type BaoMountProps, matches } from './mount-form.ts';
import { planMove } from './mount-move.ts';
import { readMount, reconcileMount } from './mount-reconcile.ts';
import { disableMount } from './mount-wire.ts';

export type { BaoMountAttributes, BaoMountProps };

export interface BaoMount extends Resource<
  'Bao.Mount',
  BaoMountProps,
  BaoMountAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoMount = Resource<BaoMount>('Bao.Mount', {
  defaultRemovalPolicy: 'retain',
});

export const BaoMountProvider = () =>
  Provider.effect(
    BaoMount,
    Effect.succeed(
      BaoMount.Provider.of({
        /**
         * ⛔ `bao secrets list` IS NOT A LIST OF THINGS THIS OWNS. Every mount in the
         *   namespace answers, including ones created by hand at bringup. Returning them
         *   would invite Alchemy to adopt — and then disable — mounts it never created.
         * ⚠️ mount-wire.ts does read that listing, for one question only: whether a mount a 400
         *   named is really absent. It never becomes a list of resources.
         */
        list: () => Effect.succeed([]),

        /** ⛔ Stateless: `Unowned` unless our own interrupted create made it (ownership/probe.ts). */
        read: Effect.fn(function* ({ fqn, instanceId, olds, output }) {
          const found = yield* readMount(olds);
          const ours = Effect.sync(() => found !== undefined && matches(found, olds));
          return yield* ownedRead({ fqn, instanceId, output }, found, ours);
        }),

        diff: Effect.fn(function* ({ instanceId, news, output }) {
          if (output === undefined) return yield* noteResume(instanceId);
          if (!isResolved(news)) return undefined;
          /**
           * ⛔ A CHANGED PATH IS DECIDED HERE, BEFORE ANY READ OF THE NEW PATH — reading it would
           *   find nothing and plan `update`, which is how an empty mount used to get enabled.
           */
          const move = planMove('Bao.Mount', output.path, news.path, news.remountFrom);
          if (move.kind === 'refuse') return yield* Effect.die(new Error(move.message));
          if (move.kind === 'move') return { action: 'update' } as const;
          const live = yield* readMount(news);
          if (live === undefined) return { action: 'update' } as const;
          /**
           * ⛔ A CHANGED `type` IS A REPLACE, AND THIS FAMILY'S DELETE IS A MOUNT DISABLE — the
           *   destruction of every secret under the mount. `kv/` is the estate's entire
           *   secret shelf, so the question "does `retain` guard the delete half of a REPLACE, or
           *   only an orphan?" is the difference between a typo and a catastrophe.
           * ★ IT GUARDS BOTH — VERIFIED IN ALCHEMY'S OWN SOURCE, not assumed. Apply.ts:2164-2173:
           *   "Honor `retain` for the old generation of a replacement, mirroring the orphan-delete
           *   path above", with `retainOldGeneration = node.removalPolicy === 'retain'`, and when
           *   it is true the engine logs "Retaining replaced resource (removal policy: retain)"
           *   and skips the delete entirely. Every mount this package declares carries the retain
           *   default (see the ★ on the resource below), so a wrong `type` string cannot disable a
           *   live mount. What it CAN do is fail: the new generation reads the SAME path, finds the
           *   old type there and dies before any write (mount-reconcile.ts) — a failed deploy, not a
           *   lost shelf (corrected 2026-09-21; this said OpenBao refused a second enable).
           * ⚠️ THAT SAFETY IS THE DECORATION'S, NOT THIS LINE'S. A caller who opts into
           *   `.pipe(RemovalPolicy.destroy())` gets the destructive replace, which is the correct
           *   meaning of opting in and is worth knowing before you type it on a mount.
           */
          if (live.type !== news.type) return { action: 'replace' } as const;
          if (matches(live, news)) return { action: 'noop' } as const;
          return { action: 'update' } as const;
        }),

        /**
         * ★ A REFUSED ENABLE OR TUNE FAILS THE EFFECT WITH OpenBao's OWN `errors`, naming the
         *   method and path — the job the per-command exit-code checks used to do by hand.
         *   The body, and the move, live in mount-reconcile.ts.
         */
        reconcile: Effect.fn(function* ({ fqn, instanceId, news, output }) {
          const claim = claimFor({ fqn, instanceId, output });
          return yield* reconcileMount(news, output?.path, undefined, claim);
        }),

        /**
         * ⛔ DISABLING A MOUNT DESTROYS EVERY SECRET UNDER IT. Idempotent as Alchemy
         *   requires — already gone is success — but retain is the default for a reason.
         */
        delete: Effect.fn(function* ({ output }) {
          yield* disableMount(output.path);
          return undefined;
        }),
      }),
    ),
  );
