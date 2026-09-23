/**
 * `Forgejo.RepoWebhook` — one repository webhook under `/repos/{owner}/{repo}/hooks`.
 *
 * ★ READ OFF `<estate>/mcp-servers/docs/api/upstream/forgejo.json`: create is POST collection; read/update/delete
 *   use numeric hook id at `/repos/{owner}/{repo}/hooks/{id}`. Now `repository.repoCreateHook` /
 *   `repoListHooks` / `repoEditHook` / `repoDeleteHook`. `fetchLive` lists and matches on `url` —
 *   see repo-webhook-form.ts for why name was never the real match key.
 *
 * ⚠️ `Hook.url` IS A REQUIRED STRING IN THE PACKAGE'S SCHEMA — the `config.url` fallback the
 *   hand-rolled client carried (`stringRecord(live['config'])['url']`) is gone; a response
 *   without `url` now fails the operation's decode.
 *
 * ⛔ NO WEBHOOK `secret` IN PROPS OR ATTRIBUTES. Optional HMAC material is env-only at write time
 *   (`FORGEJO_HOOK_SECRET_*` — see repo-webhook-form.ts). `hookConfigPublic` strips `secret` on read.
 *
 * ⛔ TOKEN NEEDS `write:repository` TO CREATE OR PATCH — list/get needs `read:repository`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as repository from '@distilled.cloud/forgejo/repository';
import * as Effect from 'effect/Effect';
import { hookConfigForm } from './repo-webhook-form.ts';
import { type ForgejoRequirements, forgejoHandlers } from './resource.ts';
import { hookConfigPublic, stringArray } from './values.ts';

export type RepoWebhookType =
  | 'dingtalk'
  | 'discord'
  | 'feishu'
  | 'forgejo'
  | 'gitea'
  | 'gogs'
  | 'msteams'
  | 'packagist'
  | 'slack'
  | 'telegram'
  | 'wechatwork';

export interface RepoWebhookProps {
  owner: string;
  repo: string;
  /** Stable locate key on this side only — Forgejo hooks have no `name` field (see the form file). */
  name: string;
  type: RepoWebhookType;
  url: string;
  events: string[];
  contentType?: 'json' | 'form';
  active?: boolean;
  branchFilter?: string;
  authorizationHeader?: string;
}

export interface RepoWebhookAttributes {
  owner: string;
  repo: string;
  name: string;
  hookId: number;
  type: RepoWebhookType;
  url: string;
  contentType: string;
  events: string[];
  active: boolean;
  branchFilter: string;
  authorizationHeader: string;
}

export interface ForgejoRepoWebhook extends Resource<
  'Forgejo.RepoWebhook',
  RepoWebhookProps,
  RepoWebhookAttributes,
  never,
  ForgejoRequirements
> {}

export const ForgejoRepoWebhook = Resource<ForgejoRepoWebhook>('Forgejo.RepoWebhook');

const handlers = forgejoHandlers<
  RepoWebhookProps,
  repository.Hook,
  RepoWebhookAttributes,
  | repository.RepoCreateHookError
  | repository.RepoEditHookError
  | repository.RepoDeleteHookError
  | repository.RepoListHooksError
>({
  attributes: (live, props) => {
    const config = hookConfigPublic(live.config);
    return {
      active: live.active ?? true,
      authorizationHeader: live.authorization_header ?? '',
      branchFilter: live.branch_filter ?? '',
      contentType: config['content_type'] ?? live.content_type ?? 'json',
      events: stringArray(live.events ?? []),
      hookId: live.id,
      name: props.name,
      owner: props.owner,
      repo: props.repo,
      type: live.type as RepoWebhookType,
      url: live.url,
    };
  },
  create: (props) =>
    repository.repoCreateHook({
      active: props.active ?? true,
      ...(props.authorizationHeader === undefined
        ? {}
        : { authorization_header: props.authorizationHeader }),
      ...(props.branchFilter === undefined ? {} : { branch_filter: props.branchFilter }),
      config: hookConfigForm(props, true),
      events: props.events,
      owner: props.owner,
      repo: props.repo,
      type: props.type,
    }),
  destroy: (props, live) =>
    repository.repoDeleteHook({ owner: props.owner, repo: props.repo, id: live.id }),
  fetchLive: (props) =>
    repository.repoListHooks({ owner: props.owner, repo: props.repo, limit: 200 }).pipe(
      Effect.map((rows) => rows.find((row) => row.url === props.url)),
      Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
    ),
  matches: (attributes, props) =>
    attributes.type === props.type &&
    attributes.url === props.url &&
    attributes.active === (props.active ?? true) &&
    attributes.contentType === (props.contentType ?? 'json') &&
    attributes.branchFilter === (props.branchFilter ?? '') &&
    attributes.authorizationHeader === (props.authorizationHeader ?? '') &&
    stringArray(props.events).join('\0') === attributes.events.join('\0'),
  update: (props, live) =>
    repository.repoEditHook({
      active: props.active ?? true,
      ...(props.authorizationHeader === undefined
        ? {}
        : { authorization_header: props.authorizationHeader }),
      ...(props.branchFilter === undefined ? {} : { branch_filter: props.branchFilter }),
      config: hookConfigForm(props, false),
      events: props.events,
      id: live.id,
      owner: props.owner,
      repo: props.repo,
    }),
});

export const ForgejoRepoWebhookProvider = () =>
  Provider.effect(ForgejoRepoWebhook, Effect.succeed(ForgejoRepoWebhook.Provider.of(handlers)));
