/**
 * JSON bodies for `Forgejo.RepoWebhook` — split to keep repo-webhook.ts under the line cap.
 *
 * ⛔ `config.secret` IS NEVER A PROP. When present it is read from `FORGEJO_HOOK_SECRET_*` at
 *   create/update time only (see hookSecretEnvKey in values.ts). Alchemy attributes are Postgres
 *   plaintext — a webhook HMAC secret must not be stored there.
 */
import type { RepoWebhookProps } from './repo-webhook.ts';
import { hookSecretEnvKey, stringRecord, text } from './values.ts';

export const hookUrl = (live: Record<string, unknown>) =>
  text(live['url']) || text(stringRecord(live['config'])['url']);

export const hookConfigForm = (props: RepoWebhookProps, includeSecret: boolean) => {
  const config: Record<string, string> = {
    content_type: props.contentType ?? 'json',
    url: props.url,
  };
  if (includeSecret) {
    const key = hookSecretEnvKey(props.owner, props.repo, props.name);
    const secret = process.env[key]?.trim();
    if (secret !== undefined && secret !== '') config['secret'] = secret;
  }
  return config;
};

export const createHookForm = (props: RepoWebhookProps) => ({
  active: props.active ?? true,
  ...(props.authorizationHeader === undefined
    ? {}
    : { authorization_header: props.authorizationHeader }),
  ...(props.branchFilter === undefined ? {} : { branch_filter: props.branchFilter }),
  config: hookConfigForm(props, true),
  events: props.events,
  name: props.name,
  type: props.type,
});

export const updateHookForm = (props: RepoWebhookProps) => ({
  active: props.active ?? true,
  ...(props.authorizationHeader === undefined
    ? {}
    : { authorization_header: props.authorizationHeader }),
  ...(props.branchFilter === undefined ? {} : { branch_filter: props.branchFilter }),
  config: hookConfigForm(props, false),
  events: props.events,
});
