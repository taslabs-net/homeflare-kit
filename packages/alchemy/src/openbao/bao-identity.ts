/**
 * Refuse to plan against the wrong vault: assert the `cluster_name` and namespace a stack expects
 * BEFORE any Bao.* resource reads or writes.
 *
 * ⛔ WHY IT EXISTS. A `BAO_ADDR` left exported for one vault (or a `BAO_AGENT_ADDR`, which wins)
 *   would otherwise apply a stack written for another vault to it, and every family here would
 *   plan CREATEs against the wrong server with a clean conscience (the estate's site-config plan,
 *   "Identity checks on every live plan").
 *   A missing `BAO_NAMESPACE` does the same thing one level down: the stack lands in root.
 *
 * ★ `sys/health`, UNAUTHENTICATED, WITH NO TOKEN AND NO NAMESPACE HEADER. READ FROM openbao v2.6.2:
 *   · http/sys_health.go:143-165 — `cluster_name` and `cluster_id` are filled ONLY while unsealed,
 *     and the body is top-level JSON, not wrapped in `data`.
 *   · http/handler.go:108-124, :405-411 — `health` is a root-only API: a request carrying
 *     `X-Vault-Namespace` is answered 400 "operation unavailable in namespaces". So the header is
 *     stripped for this one call, whatever BAO_NAMESPACE says.
 *   · The query asks for 200 when sealed, uninitialised or standby (`sealedcode`, `uninitcode`,
 *     `standbyok`, :78-110), so the body is always there to read and the refusal can say WHICH.
 *   ⛔ NO TOKEN IS SENT. Until this check passes, the server has not proved it is ours, and a token
 *     sent to an impostor is a token handed over.
 * ★ THE NAMESPACE IS CHECKED TWICE. Locally first: the namespace every later call will send (the
 *   same bao-address.ts resolution) must BE the expected one. Then remotely: unauthenticated
 *   `sys/internal/ui/mounts` with that namespace header answers 200 when the namespace exists and
 *   404 "namespace not found" when it does not (vault/request_handling.go:607-612; the path is in
 *   the system backend's Unauthenticated list, vault/logical_system.go:95). Only the status is read.
 *   REASONED FROM SOURCE, not measured against a live server.
 * ⚠️ IT PROVES THE CLUSTER, NOT THE NODE. A standby answers with the cluster's name, which is the
 *   point: a standby forwards to the same vault.
 */
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { type BaoEnvironment, resolveAddress } from './bao-address.ts';
import { BaoEnv, baoCall } from './bao-http.ts';
import { canonicalNamespace, envNamespace, namespaceLabel } from './bao-namespace.ts';
import type { BaoError } from './bao-status.ts';

/** `input` a blank expectation · `mismatch` the wrong vault · `unconfirmed` could not tell · `unreachable` no answer. */
export type BaoIdentityFailure = 'input' | 'mismatch' | 'unconfirmed' | 'unreachable';

/** ⛔ Every message starts `REFUSING:`, and none carries a token — only the address and names. */
export class BaoIdentityError extends Error {
  constructor(
    readonly reason: BaoIdentityFailure,
    detail: string,
  ) {
    super(`REFUSING: ${detail}`);
    this.name = 'BaoIdentityError';
  }
}

export interface BaoIdentityExpected {
  /** The vault's `cluster_name` (server config `cluster_name`, or the one generated at init). */
  readonly clusterName: string;
  /** The namespace the stack targets: `team-a`, or `''` / `root` for the root namespace. */
  readonly namespace: string;
}

/** What the vault said about itself once every check passed. */
export interface BaoIdentity {
  /** The resolved address, without any token. */
  readonly address: string;
  readonly clusterName: string;
  readonly clusterId: string;
  readonly version: string;
  /** Canonical: `''` is root. */
  readonly namespace: string;
}

export const HEALTH_PATH = 'sys/health?standbyok=true&sealedcode=200&uninitcode=200';
export const NAMESPACE_PROBE_PATH = 'sys/internal/ui/mounts';

const addressOf = (env: BaoEnvironment) => {
  const address = resolveAddress(env);
  return address.socket === undefined ? address.base : `unix://${address.socket}`;
};

const unreachable =
  (address: string, what: string) =>
  (error: BaoError): BaoIdentityError =>
    new BaoIdentityError('unreachable', `${address} did not answer ${what}: ${error.message}`);

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Read a health body into the one question asked of it. Pure, for the tests. */
export const checkHealth = (
  address: string,
  expectedCluster: string,
  body: Record<string, unknown> | undefined,
): { readonly clusterId: string; readonly version: string } | BaoIdentityError => {
  if (body === undefined || typeof body['sealed'] !== 'boolean') {
    return new BaoIdentityError(
      'unconfirmed',
      `${address} answered sys/health, but not as OpenBao.`,
    );
  }
  if (body['initialized'] === false) {
    return new BaoIdentityError('unconfirmed', `${address} is not initialised.`);
  }
  if (body['sealed'] === true) {
    return new BaoIdentityError(
      'unconfirmed',
      `${address} is sealed, and a sealed vault does not report its cluster_name.`,
    );
  }
  const clusterName = text(body['cluster_name']);
  if (clusterName !== expectedCluster) {
    return new BaoIdentityError(
      'mismatch',
      `${address} answers as cluster \`${clusterName || '(none)'}\`, but this stack expects ` +
        `\`${expectedCluster}\`. Check BAO_ADDR and BAO_AGENT_ADDR (the agent address wins).`,
    );
  }
  return { clusterId: text(body['cluster_id']), version: text(body['version']) };
};

/**
 * The check, as an Effect under BaoEnv (process.env unless provided). Fails with BaoIdentityError
 * and nothing else.
 */
export const assertBaoIdentityEffect = (
  expected: BaoIdentityExpected,
): Effect.Effect<BaoIdentity, BaoIdentityError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const env = yield* BaoEnv;
    const address = addressOf(env);
    const clusterName = expected.clusterName.trim();
    if (clusterName === '') {
      return yield* Effect.fail(
        new BaoIdentityError('input', 'clusterName is empty, so there is nothing to compare.'),
      );
    }
    const namespace = canonicalNamespace(expected.namespace);
    const sent = envNamespace(env);
    if (sent !== namespace) {
      return yield* Effect.fail(
        new BaoIdentityError(
          'mismatch',
          `BAO_NAMESPACE resolves to \`${namespaceLabel(sent)}\`, but this stack expects ` +
            `\`${namespaceLabel(namespace)}\`.`,
        ),
      );
    }

    const anonymous = { ...env, BAO_NAMESPACE: '', BAO_TOKEN: '' };
    const body = yield* baoCall('read', 'GET', HEALTH_PATH).pipe(
      Effect.provideService(BaoEnv, anonymous),
      Effect.mapError(unreachable(address, 'sys/health')),
    );
    const health = checkHealth(address, clusterName, body);
    if (health instanceof BaoIdentityError) return yield* Effect.fail(health);

    if (namespace !== '') {
      const scoped = { ...env, BAO_NAMESPACE: namespace, BAO_TOKEN: '' };
      const probe = yield* baoCall('read', 'GET', NAMESPACE_PROBE_PATH).pipe(
        Effect.provideService(BaoEnv, scoped),
        Effect.mapError(unreachable(address, `the namespace probe for \`${namespace}\``)),
      );
      if (probe === undefined) {
        return yield* Effect.fail(
          new BaoIdentityError(
            'mismatch',
            `cluster \`${clusterName}\` at ${address} has no namespace \`${namespace}\`.`,
          ),
        );
      }
    }
    return { address, clusterName, namespace, ...health };
  });

/**
 * `assertBaoIdentityEffect` for a plain script. `env` defaults to `process.env`, read at call time.
 * ★ Rejects with the BaoIdentityError itself (Effect.runPromise, as in approle-login.ts).
 *
 *     await assertBaoIdentity({ clusterName: 'vault-example', namespace: 'team-a' });
 */
export const assertBaoIdentity = (
  input: BaoIdentityExpected & { readonly env?: BaoEnvironment },
): Promise<BaoIdentity> => {
  const effect = assertBaoIdentityEffect(input);
  const scoped =
    input.env === undefined ? effect : Effect.provideService(effect, BaoEnv, input.env);
  return Effect.runPromise(scoped.pipe(Effect.provide(FetchHttpClient.layer)));
};
