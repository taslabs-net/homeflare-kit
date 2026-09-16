/**
 * `Forgejo.RepoWebhook` — one repository webhook under `/repos/{owner}/{repo}/hooks`.
 *
 * ★ READ OFF `house/mcp-servers/docs/api/upstream/forgejo.json`: create is POST collection; read/update/delete
 *   use numeric hook id at `/repos/{owner}/{repo}/hooks/{id}`. `locate` lists and matches on `name`.
 *
 * ⛔ NO WEBHOOK `secret` IN PROPS OR ATTRIBUTES. Optional HMAC material is env-only at write time
 *   (`FORGEJO_HOOK_SECRET_*` — see repo-webhook-form.ts). `hookConfigPublic` strips `secret` on read.
 *
 * ⛔ TOKEN NEEDS `write:repository` TO CREATE OR PATCH — list/get needs `read:repository`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { forgejo } from './client.ts';
import { createHookForm, hookUrl, updateHookForm } from './repo-webhook-form.ts';
import { type ForgejoRequirements, forgejoHandlers } from './resource.ts';
import { bool, hookConfigPublic, stringArray, text } from './values.ts';

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
  /** Stable locate key — also sent as Hook.name on create. */
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

const handlers = forgejoHandlers<RepoWebhookProps, RepoWebhookAttributes>({
  attributes: (live, props) => {
    const id = live['id'];
    if (typeof id !== 'number') return undefined;
    const config = hookConfigPublic(live['config']);
    const type = text(live['type']);
    return {
      active: bool(live['active'], true),
      authorizationHeader: text(live['authorization_header']),
      branchFilter: text(live['branch_filter']),
      contentType: text(config['content_type'], text(live['content_type'], 'json')),
      events: stringArray(live['events']),
      hookId: id,
      name: props.name,
      owner: props.owner,
      repo: props.repo,
      type: type as RepoWebhookType,
      url: hookUrl(live),
    };
  },
  collection: (props) => `repos/${props.owner}/${props.repo}/hooks`,
  createForm: createHookForm,
  locate: (props) =>
    forgejo<Record<string, unknown>[]>(
      'GET',
      `repos/${props.owner}/${props.repo}/hooks?limit=200`,
    ).pipe(
      Effect.map((rows) =>
        Array.isArray(rows)
          ? rows.find((row) => text(row['name']) === props.name || hookUrl(row) === props.url)
          : undefined,
      ),
    ),
  matches: (attributes, props) =>
    attributes.type === props.type &&
    attributes.url === props.url &&
    attributes.active === (props.active ?? true) &&
    attributes.contentType === (props.contentType ?? 'json') &&
    attributes.branchFilter === (props.branchFilter ?? '') &&
    attributes.authorizationHeader === (props.authorizationHeader ?? '') &&
    stringArray(props.events).join('\0') === attributes.events.join('\0'),
  path: (props) => `repos/${props.owner}/${props.repo}/hooks/${props.name}`,
  updateForm: updateHookForm,
  wirePath: (props, live) => `repos/${props.owner}/${props.repo}/hooks/${String(live['id'])}`,
});

export const ForgejoRepoWebhookProvider = () =>
  Provider.effect(ForgejoRepoWebhook, Effect.succeed(ForgejoRepoWebhook.Provider.of(handlers)));
