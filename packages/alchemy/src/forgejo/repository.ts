/**
 * `Forgejo.Repository` — an organization-owned git repository.
 *
 * ★ MEASURED 2026-09-13 against the live daemon (`GET /api/v1/repos/<org>/<repo>`):
 *   responses are flat JSON with `private`, `has_issues`, `default_branch`, etc. Create is
 *   `POST /orgs/{org}/repos`; read/update/delete use `/repos/{owner}/{repo}`. Now called through
 *   `@distilled.cloud/forgejo`'s `organization.createOrgRepo` / `repository.{getRepo,editRepo,
 *   deleteRepo}` instead of the retired hand-rolled client (resource.ts).
 *
 * ⛔ `CreateOrgRepoRequest` HAS NO `has_issues` / `has_wiki` / `has_projects`. Verified against
 *   the package's typed schema: Forgejo's own `POST /orgs/{org}/repos` never accepted them either
 *   (the hand-rolled client sent them anyway; Gitea's JSON decoder silently drops unknown keys,
 *   so they were always ignored on create). `editRepo`'s schema does carry them, and
 *   `updateForm`/`matches` below still converge them on the first non-create reconcile — the same
 *   two-step behaviour the old client had, now provable at the type level instead of by reading
 *   Gitea's source.
 *
 * ⛔ `defaultRemovalPolicy: 'retain'` — history, issues and packages in a repo are irreplaceable.
 *   Opt into deletion with `.pipe(RemovalPolicy.destroy())`; `delete` below is fully implemented.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as organization from '@distilled.cloud/forgejo/organization';
import * as repository from '@distilled.cloud/forgejo/repository';
import * as Effect from 'effect/Effect';
import { type ForgejoRequirements, forgejoHandlers } from './resource.ts';

export interface RepositoryProps {
  /** Organization login — the owner segment in `<org>/<repo>`. */
  org: string;
  /** Repository name. Changing it is a replace, not an update. */
  name: string;
  description?: string;
  private?: boolean;
  hasIssues?: boolean;
  hasWiki?: boolean;
  hasProjects?: boolean;
  /** Only applied when the repository already has at least one branch. */
  defaultBranch?: string;
  /** Create an initial commit with a README when the repository is new. */
  autoInit?: boolean;
}

export interface RepositoryAttributes {
  org: string;
  name: string;
  repoId: number;
  description: string;
  private: boolean;
  hasIssues: boolean;
  hasWiki: boolean;
  hasProjects: boolean;
  defaultBranch: string;
  empty: boolean;
}

export interface ForgejoRepository extends Resource<
  'Forgejo.Repository',
  RepositoryProps,
  RepositoryAttributes,
  never,
  ForgejoRequirements
> {}

export const ForgejoRepository = Resource<ForgejoRepository>('Forgejo.Repository', {
  defaultRemovalPolicy: 'retain',
});

const editForm = (props: RepositoryProps) => ({
  ...(props.defaultBranch === undefined ? {} : { default_branch: props.defaultBranch }),
  ...(props.description === undefined ? {} : { description: props.description }),
  ...(props.hasIssues === undefined ? {} : { has_issues: props.hasIssues }),
  ...(props.hasProjects === undefined ? {} : { has_projects: props.hasProjects }),
  ...(props.hasWiki === undefined ? {} : { has_wiki: props.hasWiki }),
  ...(props.private === undefined ? {} : { private: props.private }),
});

const handlers = forgejoHandlers<
  RepositoryProps,
  repository.Repository,
  RepositoryAttributes,
  | organization.CreateOrgRepoError
  | repository.GetRepoError
  | repository.EditRepoError
  | repository.DeleteRepoError
>({
  attributes: (live, props) => ({
    defaultBranch: live.default_branch,
    description: live.description ?? '',
    empty: live.empty ?? false,
    hasIssues: live.has_issues ?? true,
    hasProjects: live.has_projects ?? true,
    hasWiki: live.has_wiki ?? true,
    name: props.name,
    org: props.org,
    private: live.private ?? true,
    repoId: live.id,
  }),
  create: (props) =>
    organization.createOrgRepo({
      auto_init: props.autoInit ?? false,
      description: props.description ?? '',
      name: props.name,
      org: props.org,
      private: props.private ?? true,
    }),
  destroy: (props) => repository.deleteRepo({ owner: props.org, repo: props.name }),
  fetchLive: (props) =>
    repository
      .getRepo({ owner: props.org, repo: props.name })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  /**
   * ⛔ AN UNDECLARED FIELD IS NEITHER COMPARED NOR SENT — the rule every other family in this
   *   estate follows (storage.ts, backup-job.ts, and all four Pbs.* families say it in those
   *   words). Declaring a repo you only wanted to rename leaves its description and feature
   *   toggles alone; dropping a line no longer resets a field.
   *
   * ⚠️ `private` IS THE ONE WORTH DECLARING ANYWAY ON EVERY REPO. Leaving it undeclared means
   *   Alchemy will not notice a repository being made public. That is the correct trade for a
   *   generic family — undeclared is unmanaged, not assumed — but it is a real gap, so say it
   *   explicitly in each declaration rather than relying on a default that no longer exists.
   */
  matches: (attributes, props) =>
    (props.description === undefined || attributes.description === props.description) &&
    (props.private === undefined || attributes.private === props.private) &&
    (props.hasIssues === undefined || attributes.hasIssues === props.hasIssues) &&
    (props.hasWiki === undefined || attributes.hasWiki === props.hasWiki) &&
    (props.hasProjects === undefined || attributes.hasProjects === props.hasProjects) &&
    (props.defaultBranch === undefined || attributes.defaultBranch === props.defaultBranch),
  update: (props) =>
    repository.editRepo({ owner: props.org, repo: props.name, ...editForm(props) }),
});

export const ForgejoRepositoryProvider = () =>
  Provider.effect(ForgejoRepository, Effect.succeed(ForgejoRepository.Provider.of(handlers)));
