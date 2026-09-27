/**
 * `Talos.MachineConfig`'s read path — split out of talos-machine-config.ts (2026-09-26, fix-first
 * #1/#2 on PR 307's red team) once the ownership-aware read needed its own header, the same reason
 * machine-config-poll.ts and talos-errors.ts were split out before it. Only `import type` comes
 * back from talos-machine-config.ts, so there is no runtime cycle between the two files.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import { mintTalosconfig } from './credentials.ts';
import type { MachineConfigAttributes, MachineConfigProps } from './talos-machine-config.ts';
import { talosctl } from './talosctl.ts';
import { configDigest, extractMachineConfigSpec } from './values.ts';

/**
 * Single live read: `talosctl get machineconfig v1alpha1`, extract `spec`, hash it. No retry, no
 * swallow.
 *
 * ⛔ THE ID IS NEVER OMITTED (fix-first #2, PR 307 red team). An unfiltered `get machineconfig`
 *   lists `persistent` AND `v1alpha1`, sorted by id — `persistent` first — so a caller that does not
 *   name `v1alpha1` gets whichever the SDK's `doc[0]` happens to be, never provably the applied
 *   config (values.ts's own multi-document guard is the second half of this fix).
 * ★ `endpoints: [props.node]` (fix-first #5, same review) — without it talosctl falls back to the
 *   talosconfig context's own endpoints, which may be a control-plane VIP that only comes up AFTER
 *   bootstrap; every pre-bootstrap call in this file targets the node directly instead.
 */
export const liveSpecDigest = (props: MachineConfigProps, talosconfigPath: string) =>
  talosctl(['get', 'machineconfig', 'v1alpha1', '-o', 'yaml'], {
    endpoints: [props.node],
    nodes: [props.node],
    talosconfigPath,
  }).pipe(
    Effect.flatMap((wrapperYaml) => {
      const spec = extractMachineConfigSpec(wrapperYaml);
      return spec === undefined
        ? Effect.fail(
            new Error(
              `${props.node}: get machineconfig v1alpha1 returned no string 'spec' field — see ` +
                'values.ts extractMachineConfigSpec for the expected shape.',
            ),
          )
        : Effect.succeed(configDigest(spec));
    }),
  );

/**
 * ★ MAINTENANCE-MODE PROBE (fix-first #1, PR 307 red team). A freshly booted node has no
 *   talosconfig auth yet, so the AUTHENTICATED read above fails there exactly the same way it would
 *   against a genuinely unreachable node — the two must not be confused (a real transport failure
 *   silently read as "not created" would let a cold-start plan skip straight past a broken node).
 *   `--insecure` distinguishes them: REASONED from the published Talos quickstart
 *   (`talosctl -n <ip> version --insecure` is the documented way to confirm a maintenance-mode node
 *   before its first apply) — not measured on a live cluster. Success here means "nothing applied
 *   yet", never "converged", and never returns config content.
 */
const probeMaintenanceMode = (props: MachineConfigProps, talosconfigPath: string) =>
  talosctl(['version'], {
    endpoints: [props.node],
    insecure: true,
    nodes: [props.node],
    talosconfigPath,
  }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

/**
 * ⛔ NO SWALLOWING. A transport failure here propagates as its own error (TalosError or the
 *   shape error above) — never as `converged: false`. A false only means "read succeeded, and
 *   genuinely differs" (docs/plans/2026-09-26-talos-stack-first-boot.md, acceptance test 3).
 * ⛔ THREE-WAY COLD-START ANSWER, NOT TWO (fix-first #1). Alchemy's engine calls this exact
 *   function as its adoption probe with no prior state (alchemy beta.79 Plan.ts:1302-1318) and
 *   again to recover an interrupted create (`:1413-1450`) — both hand it nothing to distinguish
 *   "not created" from "already configured". Answering only "attrs or error" (the shipped shape)
 *   meant a maintenance-mode node's expected auth failure aborted the plan instead of reaching
 *   CREATE, and a genuinely different node's matching-cluster-CA-but-wrong-content read landed as a
 *   plain, unbranded attrs object — a silent adopt with no `adopt()`, breaking first-boot acceptance
 *   test 1 ("zero adopts"). Now: authenticated read fails but the maintenance probe succeeds →
 *   `undefined` (not created); authenticated read succeeds and the digest matches → plain attrs
 *   (ours); succeeds and differs → `Unowned` (exists, not proven ours — the digest match IS this
 *   family's ownership proof, not a state-row lookup like `ownership/probe.ts`'s generic
 *   `ownedRead`, which answers a different question: "did OUR state row create this name", not
 *   "does this node hold OUR pinned content"); both reads fail → the authenticated error propagates.
 *
 * ★ EXPORTED (like proxmox/ceph-daemon.ts's `reconcileDaemon`) so tests call it directly with a
 *   fake `ChildProcessSpawner` instead of driving it through the full Alchemy engine.
 */
export const readMachineConfig = (props: MachineConfigProps) =>
  Effect.scoped(
    Effect.gen(function* () {
      const credential = yield* mintTalosconfig(props.target);
      const outcome = yield* Effect.result(liveSpecDigest(props, credential.talosconfigPath));
      if (Result.isFailure(outcome)) {
        const reachable = yield* probeMaintenanceMode(props, credential.talosconfigPath);
        return reachable ? undefined : yield* Effect.fail(outcome.failure);
      }
      const attrs = {
        configDigest: props.configDigest,
        converged: outcome.success === props.configDigest ? ('read-back' as const) : false,
        mode: props.mode ?? 'auto',
        node: props.node,
      } satisfies MachineConfigAttributes;
      return attrs.converged === false ? Unowned(attrs) : attrs;
    }),
  );

export const diffMachineConfig = (
  news: Input<MachineConfigProps>,
  output: MachineConfigAttributes | undefined,
) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* readMachineConfig(news);
    if (live !== undefined && live.converged !== false) return { action: 'noop' } as const;
    return { action: 'update' } as const;
  });
