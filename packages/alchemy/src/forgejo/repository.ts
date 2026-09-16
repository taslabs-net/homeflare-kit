/**
 * `Forgejo.Repository` — an organization-owned git repository.
 *
 * ★ MEASURED 2026-09-13 against the live daemon (`GET /api/v1/repos/HomeFlare/homeflare-config`):
 *   responses are flat JSON with `private`, `has_issues`, `default_branch`, etc. Create is
 *   `POST /orgs/{org}/repos`; read/update/delete use `/repos/{owner}/{repo}`.
 *
 * ⛔ `defaultRemovalPolicy: 'retain'` — history, issues and packages in a repo are irreplaceable.
 *   Opt into deletion with `.pipe(RemovalPolicy.destroy())`; `delete` below is fully implemented.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type ForgejoRequirements, forgejoHandlers } from './resource.ts';
import { bool, text } from './values.ts';

export interface RepositoryProps {
  /** Organization login — the owner segment in `HomeFlare/homeflare-config`. */
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

const handlers = forgejoHandlers<RepositoryProps, RepositoryAttributes>({
  attributes: (live, props) => {
    const id = live['id'];
    if (typeof id !== 'number') return undefined;
    return {
      defaultBranch: text(live['default_branch'], 'main'),
      description: text(live['description']),
      empty: bool(live['empty']),
      hasIssues: bool(live['has_issues'], true),
      hasProjects: bool(live['has_projects'], true),
      hasWiki: bool(live['has_wiki'], true),
      name: props.name,
      org: props.org,
      private: bool(live['private'], true),
      repoId: id,
    };
  },
  collection: (props) => `orgs/${props.org}/repos`,
  createForm: (props) => ({
    auto_init: props.autoInit ?? false,
    description: props.description ?? '',
    has_issues: props.hasIssues ?? true,
    has_projects: props.hasProjects ?? true,
    has_wiki: props.hasWiki ?? true,
    name: props.name,
    private: props.private ?? true,
  }),
  /**
   * ⛔ AN UNDECLARED FIELD IS NEITHER COMPARED NOR SENT — the rule every other family in this
   *   estate follows (storage.ts, backup-job.ts, and all four Pbs.* families say it in those
   *   words), and this file was the exception.
   *
   * 🔴 WHAT THE EXCEPTION DID. Five fields were compared against a DEFAULT rather than skipped:
   *   `description ?? ''`, and `?? true` for private, hasIssues, hasWiki and hasProjects. So a
   *   declaration that simply did not mention `hasWiki` asserted "the wiki is ON", and one that
   *   did not mention `description` asserted "the description is EMPTY" — and `updateForm` sent
   *   both. Declaring a repo you only wanted to rename would have wiped its description and
   *   switched features on, reported as a plain `update`. Only `defaultBranch` was written
   *   correctly, on the line below, which is what the other five now copy.
   *
   * ⚠️ THE PRICE, STATED: dropping a line no longer resets a field. Clear one out of band in the
   *   Forgejo UI or with a direct PATCH. It costs no forever-diff, because an undeclared field is
   *   not compared either.
   *
   * ⚠️ `private` IS THE ONE WORTH DECLARING ANYWAY ON EVERY REPO. Leaving it undeclared now means
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
  path: (props) => `repos/${props.org}/${props.name}`,
  updateForm: (props) => ({
    ...(props.defaultBranch === undefined ? {} : { default_branch: props.defaultBranch }),
    ...(props.description === undefined ? {} : { description: props.description }),
    ...(props.hasIssues === undefined ? {} : { has_issues: props.hasIssues }),
    ...(props.hasProjects === undefined ? {} : { has_projects: props.hasProjects }),
    ...(props.hasWiki === undefined ? {} : { has_wiki: props.hasWiki }),
    ...(props.private === undefined ? {} : { private: props.private }),
  }),
});

export const ForgejoRepositoryProvider = () =>
  Provider.effect(ForgejoRepository, Effect.succeed(ForgejoRepository.Provider.of(handlers)));
