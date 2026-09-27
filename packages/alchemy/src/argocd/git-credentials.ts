/**
 * The write-only credential shape `Repository` and `RepoCreds` share — Argo CD's own REST schema
 * gives both the same four secret-shaped fields (`password`, `sshPrivateKey`, `bearerToken`,
 * `tlsClientCertKey` — measured against `V1alpha1Repository`/`V1alpha1RepoCreds` in the generated
 * `services/argocd.ts`, distilled homeflare/base). One helper here instead of two copies.
 *
 * ⛔ NO SECRET VALUE IS EVER A PROP OR AN ATTRIBUTE — `../secrets/write-only.ts`'s rule. A prop
 *   carries only the NAME of the environment variable holding a value (`FromEnv`); the value is
 *   read at call time and sent on the wire, never stored.
 *
 * ⚠️ NO DRIFT DETECTION ON THE SECRET FIELDS, ON PURPOSE — same simplification
 *   `../forgejo/org-actions-secrets.ts` makes for the identical problem (Argo CD's GET never
 *   returns `password`/`sshPrivateKey`/`bearerToken`/`tlsClientCertKey` back, so there is nothing
 *   to diff against). `matches` in each resource file compares only the PLAIN fields the API does
 *   return; a changed credential is written once on create and never rotated automatically —
 *   rotate by destroy-then-create, or a manual call outside Alchemy. A seal-based drift check
 *   (`../secrets/write-only.ts#seal`) is possible later if that limitation becomes a real problem;
 *   `proxmox/pbs-notification-target-lifecycle.ts` is the reference for what that costs in file size.
 */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { type FromEnv, resolveAll } from '../secrets/write-only.ts';

export interface GitCredentialRefs {
  readonly password?: FromEnv;
  readonly sshPrivateKey?: FromEnv;
  readonly bearerToken?: FromEnv;
  readonly tlsClientCertKey?: FromEnv;
}

export interface ResolvedGitCredentials {
  readonly password?: string;
  readonly sshPrivateKey?: string;
  readonly bearerToken?: string;
  readonly tlsClientCertKey?: string;
}

/** Domain refusal, not a distilled error — a declared credential's env var is unset at call time. */
export class ArgocdSecretEnvUnsetError extends Data.TaggedError('ArgocdSecretEnvUnsetError')<{
  readonly message: string;
}> {}

/** Only the refs actually declared — `resolveAll` takes no `undefined` values. */
const declaredRefs = (refs: GitCredentialRefs): Readonly<Record<string, FromEnv>> => {
  const out: Record<string, FromEnv> = {};
  if (refs.password !== undefined) out.password = refs.password;
  if (refs.sshPrivateKey !== undefined) out.sshPrivateKey = refs.sshPrivateKey;
  if (refs.bearerToken !== undefined) out.bearerToken = refs.bearerToken;
  if (refs.tlsClientCertKey !== undefined) out.tlsClientCertKey = refs.tlsClientCertKey;
  return out;
};

/**
 * Resolves every declared ref from the deploying process's own environment, or fails with the
 * names of whichever are missing — never a value, in the failure or anywhere else.
 */
export const resolveGitCredentials = (
  refs: GitCredentialRefs,
): Effect.Effect<ResolvedGitCredentials, ArgocdSecretEnvUnsetError> => {
  const { values, missing } = resolveAll(declaredRefs(refs));
  if (missing.length > 0) {
    return Effect.fail(
      new ArgocdSecretEnvUnsetError({
        message:
          `credential write requires ${missing.join(', ')}, unset or empty in the ` +
          'deploying environment. Export it and deploy again.',
      }),
    );
  }
  return Effect.succeed(values as ResolvedGitCredentials);
};
