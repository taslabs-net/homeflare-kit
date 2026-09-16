/**
 * `Forgejo.OrgSecret` — org-level Actions secret metadata at `/orgs/{org}/actions/secrets/{name}`.
 *
 * ★ CHOICE: AUTHORED WITH WRITE-ONLY VALUE VIA ENV, NOT REFUSED. The OpenAPI in
 *   `house/mcp-servers/docs/api/upstream/forgejo.json` shows `Secret` returns only `name` and
 *   `created_at` — never the `data` field — so attributes stay metadata-only. Create/update is PUT
 *   with body `{ data }`, which does not fit POST/PATCH; this family uses the `upsert` seam on
 *   `ForgejoSpec` instead of hand-rolling provider handlers.
 *
 * ⛔ THE SECRET VALUE IS NEVER A PROP OR AN ATTRIBUTE. It is read from `FORGEJO_ORG_SECRET_{org}_{name}`
 *   (see orgSecretEnvKey) at PUT time when the name is absent from the list. Once present, reconcile
 *   noops — the API cannot confirm the value matches, and re-PUT on every deploy would rotate
 *   unintentionally. Rotate by destroy-then-create or a manual PUT outside Alchemy.
 *
 * ⚠️ PUT ANSWERS 201/204 WITH NO BODY — client.ts treats empty responses as `undefined`; read-back
 *   uses the list endpoint, not the PUT response.
 *
 * ⛔ TOKEN NEEDS `write:organization` TO PUT — list needs `read:organization`.
 *
 * ⛔ THE FILE NAME IS PLURAL ON PURPOSE AND MUST STAY THAT WAY. `.gitignore:198` carries
 *   `*-secret.*` — the rule that stops `client-secret.json` and friends being committed — and it
 *   matches a SOURCE file called `org-secret.ts` just as happily. This family was first authored
 *   under that name: it existed on disk, typechecked, passed oxlint, was imported by alchemy.run.ts
 *   and appeared in NO `git status`. It would have been committed as a broken import for everyone
 *   else, with the local tree green the whole time. `scripts/husky/ignored-imports.ts` is the gate
 *   that now catches the class; this comment is for whoever is tempted to rename it back.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { ForgejoError, forgejo } from './client.ts';
import { type ForgejoRequirements, forgejoHandlers } from './resource.ts';
import { orgSecretEnvKey, text } from './values.ts';

export interface OrgSecretProps {
  org: string;
  /** Secret name — path key; value lives in env, not here. */
  name: string;
}

export interface OrgSecretAttributes {
  org: string;
  name: string;
  createdAt: string;
}

export interface ForgejoOrgSecret extends Resource<
  'Forgejo.OrgSecret',
  OrgSecretProps,
  OrgSecretAttributes,
  never,
  ForgejoRequirements
> {}

export const ForgejoOrgSecret = Resource<ForgejoOrgSecret>('Forgejo.OrgSecret');

const secretData = (org: string, name: string) =>
  Effect.gen(function* () {
    const key = orgSecretEnvKey(org, name);
    const raw = process.env[key];
    if (raw === undefined || raw.trim() === '') {
      return yield* Effect.fail(
        new ForgejoError(
          0,
          'PUT',
          `orgs/${org}/actions/secrets/${name}`,
          `${key} is unset. Export the secret value there — never as an Alchemy prop.`,
        ),
      );
    }
    return raw.trim();
  });

const handlers = forgejoHandlers<OrgSecretProps, OrgSecretAttributes>({
  attributes: (live, props) => ({
    createdAt: text(live['created_at']),
    name: props.name,
    org: props.org,
  }),
  collection: (props) => `orgs/${props.org}/actions/secrets/${props.name}`,
  createForm: () => ({}),
  locate: (props) =>
    forgejo<Record<string, unknown>[]>('GET', `orgs/${props.org}/actions/secrets?limit=200`).pipe(
      Effect.map((rows) =>
        Array.isArray(rows) ? rows.find((row) => row['name'] === props.name) : undefined,
      ),
    ),
  matches: () => true,
  path: (props) => `orgs/${props.org}/actions/secrets/${props.name}`,
  upsert: (props, before) =>
    Effect.gen(function* () {
      if (before !== undefined) return;
      const data = yield* secretData(props.org, props.name);
      yield* forgejo('PUT', `orgs/${props.org}/actions/secrets/${props.name}`, { data });
    }),
});

export const ForgejoOrgSecretProvider = () =>
  Provider.effect(ForgejoOrgSecret, Effect.succeed(ForgejoOrgSecret.Provider.of(handlers)));
