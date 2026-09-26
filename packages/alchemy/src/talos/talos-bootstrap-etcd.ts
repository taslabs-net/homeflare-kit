/**
 * `Talos.Bootstrap`'s etcd-members probe and split-brain guard — split out of talos-bootstrap.ts
 * (LAND, 2026-09-26, I4 fix) once adding the guard pushed that file over the 250-line cap, the same
 * reason machine-config-read.ts was split out of talos-machine-config.ts before it. Only
 * `import type` comes back from talos-bootstrap.ts, so there is no runtime cycle between the files.
 */
import * as Effect from 'effect/Effect';
import type { BootstrapProps } from './talos-bootstrap.ts';
import { TalosReBootstrapRefused } from './talos-errors.ts';
import { talosctl } from './talosctl.ts';

/**
 * REASONED: `talosctl get etcdmembers -o json` should list members after bootstrap.
 * ⚠️ NOT MEASURED — first live deploy confirms the resource type name.
 * ⛔ NO SWALLOWING (K-talos-first-boot) — a transport failure propagates as its own error; only a
 *   SUCCESSFUL read may conclude presence or absence. Every caller decides for itself what a
 *   failure here means (talos-bootstrap.ts's `read`/`reconcile`, and `assertNoLivePeers` below), so
 *   it is not decided here.
 */
export const isBootstrapped = (props: BootstrapProps, talosconfigPath: string) =>
  talosctl(['get', 'etcdmembers', '-o', 'json'], {
    nodes: [props.node],
    talosconfigPath,
  }).pipe(Effect.map((text) => text.includes('"id"') || text.includes('"member"')));

/**
 * ⛔ I4 FIX (LAND red team, 2026-09-26) — THE CREATE PATH ONLY CHECKED THIS NODE. If the state row
 *   is lost (wrong `--stage`, an FQN rename, a wiped state store) while the cluster already lives on
 *   OTHER control-plane nodes, the cold-start adoption read on THIS node comes back empty, plan
 *   calls `create`, and `talosctl bootstrap` runs here too — a SECOND, isolated etcd cluster: split
 *   brain. Before bootstrapping, every OTHER declared control-plane node (`props.peers`) must show a
 *   successful, EMPTY etcd-members read — proof no cluster already exists anywhere this row knows
 *   about. A peer that already has members, or a peer whose read fails, refuses bootstrap exactly
 *   like an already-bootstrapped confirmation failure does (same typed error, same "hand it to a
 *   human" posture) — a genuinely fresh cluster has no peers with members yet, so this never blocks
 *   a real first boot.
 * ⚠️ `peers` IS OPTIONAL, SO THIS GUARD IS OPT-IN — an existing single-control-plane declaration
 *   keeps working unguarded; a consuming stack with more than one control-plane node (decision 66:
 *   3, one per TB4 node) SHOULD list the other two here to get the protection.
 * ★ `Effect.all` over a mapped array, not `Effect.forEach` — oxlint's unicorn/no-array-for-each
 *   matches the method NAME and cannot tell Effect's from Array's (same pattern as
 *   openbao/cloudflare-permission-groups.ts).
 */
export const assertNoLivePeers = (props: BootstrapProps, talosconfigPath: string) =>
  Effect.all(
    (props.peers ?? []).map((peer) =>
      isBootstrapped({ ...props, node: peer }, talosconfigPath).pipe(
        Effect.matchEffect({
          onFailure: (cause) =>
            Effect.fail(
              new TalosReBootstrapRefused({
                detail: `peer ${peer}: live read failed before bootstrap: ${String(cause)}`,
                node: props.node,
              }),
            ),
          onSuccess: (hasMembers) =>
            hasMembers
              ? Effect.fail(
                  new TalosReBootstrapRefused({
                    detail:
                      `peer ${peer} already reports etcd members — a cluster may already exist; ` +
                      'refusing to bootstrap a second one',
                    node: props.node,
                  }),
                )
              : Effect.void,
        }),
      ),
    ),
    { discard: true },
  );
