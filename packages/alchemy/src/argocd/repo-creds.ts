/**
 * `Argocd.RepoCreds` — a credential TEMPLATE that Argo CD applies to any repository whose URL
 * starts with `url` (`/api/v1/repocreds`) — distinct from `Argocd.Repository`, which registers one
 * specific repository. REST-managed, not a CRD; see `docs/argocd.md`.
 *
 * ⚠️ NO `GetRepoCredsService` OPERATION EXISTS — measured against the operation list in
 *   `services/argocd.ts` (distilled homeflare/base): Create/Update/Delete/List only, no single-item
 *   Get. `fetchLive` below lists and finds by `url`, the same shape
 *   `discord/guild-application-command.ts#fetchByName` and
 *   `forgejo/org-actions-secrets.ts#fetchLive` use for the same reason.
 *
 * ⚠️ NO LIVE ARGO CD INSTANCE EXISTS ON THE ESTATE (2026-09-24) — see `docs/argocd.md`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as argocd from '@distilled.cloud/argocd/argocd';
import * as Effect from 'effect/Effect';
import {
  type ArgocdSecretEnvUnsetError,
  type GitCredentialRefs,
  resolveGitCredentials,
} from './git-credentials.ts';
import { type ArgocdRequirements, type ArgocdSpec, argocdHandlers, present } from './resource.ts';

export interface RepoCredsProps {
  /** The URL prefix this template matches — identity key; changing it is a replace. */
  url: string;
  /** "git" (default), "helm" or "oci". */
  type?: string;
  username?: string;
  /** The client certificate itself — public, unlike its key. */
  tlsClientCertData?: string;
  /** Write-only — see `git-credentials.ts`. Never a value here, only env var names. */
  credentials?: GitCredentialRefs;
}

export interface RepoCredsAttributes {
  url: string;
  type: string | undefined;
  username: string | undefined;
  tlsClientCertData: string | undefined;
}

export interface ArgocdRepoCreds extends Resource<
  'Argocd.RepoCreds',
  RepoCredsProps,
  RepoCredsAttributes,
  never,
  ArgocdRequirements
> {}

export const ArgocdRepoCreds = Resource<ArgocdRepoCreds>('Argocd.RepoCreds');

const attributesOf = (live: argocd.V1alpha1RepoCreds): RepoCredsAttributes => ({
  tlsClientCertData: live.tlsClientCertData,
  type: live.type,
  url: live.url ?? '',
  username: live.username,
});

/** Only the plain fields — see `git-credentials.ts` for why the secret fields are excluded. */
const plainMatches = (attrs: RepoCredsAttributes, props: RepoCredsProps): boolean =>
  (props.type ?? 'git') === (attrs.type ?? 'git') &&
  (props.username ?? undefined) === (attrs.username ?? undefined) &&
  (props.tlsClientCertData ?? undefined) === (attrs.tlsClientCertData ?? undefined);

type RepoCredsError =
  | argocd.ListRepoCredsServiceRepositoryCredentialsError
  | argocd.CreateRepoCredsServiceRepositoryCredentialsError
  | argocd.DeleteRepoCredsServiceRepositoryCredentialsError
  | ArgocdSecretEnvUnsetError;

/** ★ EXPORTED for direct testing against `fake-argocd.ts` — see `repo-creds.test.ts`. */
export const spec: ArgocdSpec<
  RepoCredsProps,
  argocd.V1alpha1RepoCreds,
  RepoCredsAttributes,
  RepoCredsError
> = {
  attributes: (live) => attributesOf(live),
  // ★ Catches the DELETE call's own NotFound too — closes the TOCTOU race between the pre-check
  //   `fetchLive` above and this call. Matches upstream's Hetzner/Certificate.ts `deleteById`.
  destroy: (props) =>
    argocd
      .deleteRepoCredsServiceRepositoryCredentials({ url: props.url })
      .pipe(Effect.catchTag('NotFound', () => Effect.void)),
  identityOfAttributes: (attrs) => attrs.url,
  identityOfProps: (props) => props.url,
  fetchLive: (props) =>
    argocd.listRepoCredsServiceRepositoryCredentials({ url: props.url }).pipe(
      Effect.map((page) => (page.items ?? []).find((row) => row.url === props.url)),
      Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
    ),
  matches: plainMatches,
  upsert: (props) =>
    resolveGitCredentials(props.credentials ?? {}).pipe(
      Effect.flatMap((creds) =>
        argocd.createRepoCredsServiceRepositoryCredentials(
          present({
            upsert: true,
            tlsClientCertData: props.tlsClientCertData,
            type: props.type,
            url: props.url,
            username: props.username,
            ...creds,
          }),
        ),
      ),
    ),
};

export const handlers = argocdHandlers(spec);

export const ArgocdRepoCredsProvider = () =>
  Provider.effect(ArgocdRepoCreds, Effect.succeed(ArgocdRepoCreds.Provider.of(handlers)));
