/**
 * `Talos.Kubeconfig` — fetch admin kubeconfig so `Kubernetes.*` workloads can connect.
 *
 * ★ REASONED FROM talosctl kubeconfig (Talos v1.13 CLI reference): writes a kubeconfig file;
 *   `--merge=false` keeps it isolated; `-f/--force` overwrites an existing file.
 *
 * ⛔ THE KUBECONFIG FILE CONTAINS A CLIENT CERTIFICATE — IT MUST NOT BE AN ATTRIBUTE. Alchemy
 *   persists attributes unencrypted. This resource persists ONLY public metadata + fingerprints,
 *   never the file's own bytes.
 *
 * ⛔ LANDS IN OPENBAO, NOT A HOST `runtimePath` (K-talos-first-boot, 2026-09-26). The shipped shape
 *   wrote a cluster-admin kubeconfig to un-vaulted host disk and never removed it — the exact class
 *   of exposure `talos/credentials.ts`'s own header exists to prevent — and its own `read` depended
 *   on that file's continued presence, so verifying from any other host planned `update` forever
 *   (docs/plans/2026-09-26-talos-secrets-flow.md's "Measured today" section). Fixed:
 *     - CREATE (`output === undefined`) runs `talosctl kubeconfig` into a throwaway, unguessable
 *       temp path (this file's own `reservedTempPath`), reads it back, and writes its bytes into
 *       OpenBao at `target.mount`/`kubeconfigKey` via stdin (`credentials-write.ts`'s
 *       `writeKvValue` — ⛔ never argv) — never to any path a caller could depend on.
 *     - ⛔ WRITTEN ONCE, NOT RE-MINTED EVERY DEPLOY. `talosctl kubeconfig` always issues a FRESH
 *       admin client certificate; re-running it every reconcile would rotate credentials for no
 *       reason and violate O1's write-once-at-bring-up grant on this one key
 *       (docs/plans/2026-09-26-talos-secrets-flow.md, O1). Once `output` is defined, reconcile only
 *       reads the vault copy back to confirm it — the same "once" shape `talos-bootstrap.ts` uses
 *       for a boolean, here for a value.
 *     - The persisted `connection` is auth kind `talos-openbao`: `{ kind, cluster }`
 *       only. The adapter reads the vault at connect time and returns a `ClusterTransport`.
 *       ⛔ Not the stock `kubeconfig` kind (an absent path falls back to `$KUBECONFIG`) and not
 *       `client-cert` (alchemy `Connection.ts` persists that PEM on every workload's attributes).
 */
import { chmodSync } from 'node:fs';
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import type { Connection } from 'alchemy/Kubernetes/Connection';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import {
  DEFAULT_KUBECONFIG_KEY,
  isVaultKeyAbsent,
  mintTalosconfig,
  readKvValue,
} from './credentials.ts';
import { reservedTempPath, writeKvValue } from './credentials-write.ts';
import { buildAttrs } from './kubeconfig-attrs.ts';
import type { TalosRequirements, WithTarget } from './resource.ts';
import { talosctl } from './talosctl.ts';

export interface KubeconfigProps extends WithTarget {
  /** Node that serves `talosctl kubeconfig`. */
  node: string;
  /** Context name inside the generated kubeconfig — not secret. */
  context: string;
  /** OpenBao KV path under `target.mount` for the written kubeconfig. Default `'kubeconfig'`. */
  kubeconfigKey?: string;
  after?: readonly unknown[];
}

export interface KubeconfigAttributes {
  context: string;
  endpoint: string;
  certificateAuthorityFingerprint: string;
  clientCertificateFingerprint: string;
  /** Digest of endpoint+context+fingerprints — detects credential rotation without storing PEM. */
  credentialGeneration: string;
  /**
   * `talos-openbao` connection: mount, key and context only. Workloads resolve the admin
   * material at connect time. This object never carries PEM or a filesystem path.
   */
  connection: Connection;
}

export interface TalosKubeconfig extends Resource<
  'Talos.Kubeconfig',
  KubeconfigProps,
  KubeconfigAttributes,
  never,
  TalosRequirements
> {}

export const TalosKubeconfig = Resource<TalosKubeconfig>('Talos.Kubeconfig');

/** Absence is {@link isVaultKeyAbsent} — measured OpenBao v2.6.2 text, not every bao failure. */
const readVaultMeta = (props: KubeconfigProps, key: string) =>
  readKvValue(props.target.mount, key, ['kubeconfig', 'config']).pipe(
    Effect.catchIf(isVaultKeyAbsent, () => Effect.succeed(undefined)),
  );

/**
 * ★ EXPORTED for kubeconfig.test.ts — see talos-bootstrap.ts's own note on the pattern.
 *
 * ⛔ C1 FIX (LAND red team, 2026-09-26) — `undefined` NOW MEANS ONLY "the key has never been
 *   written", NEVER "some read failed". The shipped `Effect.orElseSucceed` folded EVERY failure —
 *   including a vault outage or wrong mount — into a defined, empty-fingerprint object. Alchemy's
 *   engine always adopts a defined cold-start `read` result and forces `update` (alchemy beta.79
 *   `Plan.ts:1303-1352`), so `reconcileKubeconfig`'s write-once branch (`output !== undefined`)
 *   then tried to CONFIRM a key that had never actually been written, and failed every time —
 *   `Talos.Kubeconfig` could never be created. Vault content that EXISTS but does not parse as a
 *   kubeconfig is a different, fail-closed case (below), never treated as absence.
 */
export const readKubeconfig = (props: KubeconfigProps) =>
  Effect.gen(function* () {
    const key = props.kubeconfigKey ?? DEFAULT_KUBECONFIG_KEY;
    const raw = yield* readVaultMeta(props, key);
    if (raw === undefined) return undefined;
    const meta = buildAttrs(raw, props);
    if (meta === undefined) {
      return yield* Effect.fail(
        new Error(
          `${props.target.mount}/${key}: vault content exists but does not parse as a kubeconfig ` +
            `for context ${props.context} — not a cold start. Fix the KV entry or the pinned ` +
            'context rather than trusting an empty read.',
        ),
      );
    }
    return meta;
  });

/** ★ Key order is state-store noise (a row saved by another build), not drift: sort like upstream. */
const sortedJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

export const diffKubeconfig = (
  news: Input<KubeconfigProps>,
  output: KubeconfigAttributes | undefined,
) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* readKubeconfig(news);
    if (
      live !== undefined &&
      live.credentialGeneration === output.credentialGeneration &&
      live.context === output.context &&
      // ⚠️ Rows saved before `talos-openbao` carry a dead placeholder (or none); they must update.
      sortedJson(live.connection?.auth) === sortedJson(output.connection?.auth) &&
      live.endpoint === output.endpoint
    ) {
      return { action: 'noop' } as const;
    }
    return { action: 'update' } as const;
  });

/**
 * ⛔ WRAPPED IN `Effect.scoped` — same C1-lifetime reasoning as every other Talos resource file:
 *   `mintTalosconfig` and `reservedTempPath` both contribute `Scope.Scope`, and this is the caller
 *   that owns their lifetime for the whole reconcile.
 * ⛔ WRITE-ONCE — see this file's own header. A bring-up already ran; this branch never spawns
 *   `talosctl kubeconfig` or writes to the vault again.
 * ⛔ GATED ON `credentialGeneration`, NOT JUST `output !== undefined` (C1 fix, LAND red team,
 *   belt-and-suspenders alongside the `read` fix above) — `output`'s own type still allows a
 *   defined-but-empty value (state persisted by a pre-fix build's `emptyAttrs()`, or any future
 *   caller that hands this function a stale row). Treat that exactly like `undefined` — mint and
 *   write once — rather than take the confirm-only branch and fail trying to read back a key that
 *   was never actually written.
 */
export const reconcileKubeconfig = (
  props: KubeconfigProps,
  output: KubeconfigAttributes | undefined,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const key = props.kubeconfigKey ?? DEFAULT_KUBECONFIG_KEY;

      if (output !== undefined && output.credentialGeneration !== '') {
        const raw = yield* readKvValue(props.target.mount, key, ['kubeconfig', 'config']);
        const meta = buildAttrs(raw, props);
        if (meta === undefined) {
          return yield* Effect.die(
            new Error(
              `${props.target.mount}/${key}: vault content no longer parses as a kubeconfig for ` +
                `context ${props.context}. Read back rather than trusting the write once.`,
            ),
          );
        }
        return meta;
      }

      const credential = yield* mintTalosconfig(props.target);
      const { path: outPath } = yield* reservedTempPath(
        `${props.target.cluster}-${props.node}-kubeconfig-out`,
      );
      yield* talosctl(
        ['kubeconfig', outPath, '--merge=false', '--force', '--force-context-name', props.context],
        { nodes: [props.node], talosconfigPath: credential.talosconfigPath },
      );
      const raw = yield* Effect.tryPromise({
        catch: (cause) => new Error(`${outPath}: reading generated kubeconfig: ${String(cause)}`),
        try: () => Bun.file(outPath).text(),
      });
      if (raw.trim() === '') {
        return yield* Effect.die(
          new Error(
            `${props.node}: talosctl kubeconfig returned no error but wrote an empty file. Read ` +
              'back rather than trusting the exit code alone.',
          ),
        );
      }
      // ⚠️ REASONED, not measured: talosctl's own writer likely already uses 0600 like most Go
      //   credential writers, but this chmods defensively regardless — same posture as
      //   credentials.ts's mintKvTempFile.
      yield* Effect.try({
        catch: (cause) => new Error(`${outPath}: chmod 0600: ${String(cause)}`),
        try: () => chmodSync(outPath, 0o600),
      });
      const meta = buildAttrs(raw, props);
      if (meta === undefined) {
        return yield* Effect.die(
          new Error(
            `${props.node}: talosctl kubeconfig wrote a file that does not parse for context ` +
              `${props.context}.`,
          ),
        );
      }
      yield* writeKvValue(props.target.mount, key, 'kubeconfig', raw);
      return meta;
    }),
  );

const handlers = {
  delete: () => Effect.void,
  diff: ({
    news,
    output,
  }: {
    news: Input<KubeconfigProps>;
    output: KubeconfigAttributes | undefined;
  }) => diffKubeconfig(news, output),
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: KubeconfigProps }) => readKubeconfig(olds),
  reconcile: ({
    news,
    output,
  }: {
    news: KubeconfigProps;
    output: KubeconfigAttributes | undefined;
  }) => reconcileKubeconfig(news, output),
};

export const TalosKubeconfigProvider = () =>
  Provider.effect(TalosKubeconfig, Effect.succeed(TalosKubeconfig.Provider.of(handlers)));
