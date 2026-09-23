/**
 * `config` bodies for `Forgejo.RepoWebhook` — split to keep repo-webhook.ts under the line cap.
 *
 * ⛔ `config.secret` IS NEVER A PROP. When present it is read from `FORGEJO_HOOK_SECRET_*` at
 *   create/update time only (see hookSecretEnvKey in values.ts). Alchemy attributes are Postgres
 *   plaintext — a webhook HMAC secret must not be stored there.
 *
 * ⛔ NO `name` FIELD ON EITHER SIDE. `@distilled.cloud/forgejo`'s `RepoCreateHookRequest` and
 *   `Hook` (the create input and the read/list output) have no `name` property — verified against
 *   the package's schema. The hand-rolled client sent `name: props.name` on create anyway; Gitea's
 *   JSON decoder silently dropped it, so `locate` never actually matched by name either (its
 *   `row['name']` read was always `undefined` on an untyped response) — matching was always by
 *   URL in practice. `props.name`/`RepoWebhookAttributes.name` stay as this family's own stable
 *   key; nothing on the wire carries it.
 */
import type { RepoWebhookProps } from './repo-webhook.ts';
import { hookSecretEnvKey } from './values.ts';

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
