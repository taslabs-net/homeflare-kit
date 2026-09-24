/**
 * `ArgoCD.Repository` — one git (or Helm) repository credential registered with Argo CD.
 *
 * ★ WALKED 2026-09-24 against `@distilled.cloud/argocd@1.0.0-rc.12`: create is
 *   `POST /api/v1/repositories`, get/update/delete use `/api/v1/repositories/{repo}`
 *   (the URL is a path label; Distilled `encodeURIComponent`s it). Password on the wire is
 *   Distilled's `SensitiveValue` — already `Redacted` in the generated request type.
 *
 * ⛔ THE PASSWORD IS NEVER A PROP OR AN ATTRIBUTE (S25). `passwordEnv` is an env var NAME,
 *   resolved inside `create`/`update` the way `Grafana.Datasource.secureJsonDataRefs` is.
 *   Argo CD's GET never returns the secret; `matches` cannot detect value drift — only
 *   whether username / type / project drifted. Rotate by destroy-then-create.
 *
 * ⛔ RepoCreds (URL-prefix credential sets) and write-repositories are Distilled-covered and
 *   not modeled here — see docs/argocd.md.
 */
import { adopt } from 'alchemy/AdoptPolicy';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as argocd from '@distilled.cloud/argocd';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { type ArgoCDSpec, argocdHandlers } from './resource.ts';
import { text } from './values.ts';

export interface RepositoryProps {
  /** Repository URL — path key. Changing it is a replace, not an update. */
  repo: string;
  name?: string;
  /** `git` (default) or `helm`. */
  type?: 'git' | 'helm';
  project?: string;
  username?: string;
  /** Env var NAME holding the repo password / token. Never the value. */
  passwordEnv?: string;
  insecure?: boolean;
}

export interface RepositoryAttributes {
  repo: string;
  name: string;
  type: string;
  project: string;
  username: string;
  insecure: boolean;
  connectionStatus: string;
}

export interface ArgoCDRepository extends Resource<
  'ArgoCD.Repository',
  RepositoryProps,
  RepositoryAttributes,
  never
> {}

export const ArgoCDRepository = Resource<ArgoCDRepository>('ArgoCD.Repository', {
  defaultRemovalPolicy: 'retain',
});

export const isArgoCDRepository = (value: unknown): value is ArgoCDRepository =>
  typeof value === 'object' &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'ArgoCD.Repository';

/** A named password env var is unset — a domain refusal, not a distilled error. */
export class ArgoCDSecretRefUnsetError extends Data.TaggedError('ArgoCDSecretRefUnsetError')<{
  readonly message: string;
}> {}

const resolvePassword = (
  envVar: string | undefined,
): Effect.Effect<string | undefined, ArgoCDSecretRefUnsetError> =>
  Effect.gen(function* () {
    if (envVar === undefined) return undefined;
    const raw = process.env[envVar];
    if (raw === undefined || raw.trim() === '') {
      return yield* Effect.fail(
        new ArgoCDSecretRefUnsetError({
          message: `${envVar} is unset. Export the repository password there — never as an Alchemy prop.`,
        }),
      );
    }
    return raw.trim();
  });

const publicFields = (props: RepositoryProps) => ({
  repo: props.repo,
  ...(props.insecure === undefined ? {} : { insecure: props.insecure }),
  ...(props.name === undefined ? {} : { name: props.name }),
  ...(props.project === undefined ? {} : { project: props.project }),
  ...(props.type === undefined ? {} : { type: props.type }),
  ...(props.username === undefined ? {} : { username: props.username }),
});

export const spec: ArgoCDSpec<
  RepositoryProps,
  argocd.V1alpha1Repository,
  RepositoryAttributes,
  argocd.ArgocdOpError | ArgoCDSecretRefUnsetError
> = {
  attributes: (live, props) => ({
    connectionStatus: text(live.connectionState?.status),
    insecure: live.insecure === true,
    name: text(live.name),
    project: text(live.project),
    repo: text(live.repo) || props.repo,
    type: text(live.type) || 'git',
    username: text(live.username),
  }),
  create: (props) =>
    Effect.flatMap(resolvePassword(props.passwordEnv), (password) =>
      argocd.createRepositoryServiceRepository({
        ...publicFields(props),
        ...(password === undefined ? {} : { password }),
      }),
    ),
  describe: (props) => `repositories/${props.repo}`,
  destroy: (props) => argocd.deleteRepositoryServiceRepository({ repo: props.repo }),
  fetchLive: (props) =>
    argocd
      .getRepositoryService({ repo: props.repo })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  /**
   * ⛔ `passwordEnv` IS NEVER COMPARED. Argo CD never returns the secret; Distilled marks it
   *   `SensitiveValue`. Drift in the password itself is invisible to `plan`.
   */
  matches: (attributes, props) =>
    (props.name === undefined || attributes.name === props.name) &&
    (props.type === undefined || attributes.type === props.type) &&
    (props.project === undefined || attributes.project === props.project) &&
    (props.username === undefined || attributes.username === props.username) &&
    (props.insecure === undefined || attributes.insecure === props.insecure),
  update: (props) =>
    Effect.flatMap(resolvePassword(props.passwordEnv), (password) =>
      argocd.updateRepositoryServiceRepository({
        ...publicFields(props),
        ...(password === undefined ? {} : { password }),
        repo_repo: props.repo,
      }),
    ),
};

export const handlers = argocdHandlers(spec);

export const ArgoCDRepositoryProvider = () =>
  Provider.effect(ArgoCDRepository, Effect.succeed(ArgoCDRepository.Provider.of(handlers)));

export const repository = (id: string, props: RepositoryProps) =>
  ArgoCDRepository(id, props).pipe(adopt(true));
