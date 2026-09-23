/**
 * `Forgejo.OrgSecret` — org-level Actions secret metadata at `/orgs/{org}/actions/secrets/{name}`.
 *
 * ★ CHOICE: AUTHORED WITH WRITE-ONLY VALUE VIA ENV, NOT REFUSED. `organization.Secret` (the
 *   package's typed output) has only `name` and `created_at` — never `data` — so attributes stay
 *   metadata-only. Create/update is `updateOrgSecret`, a PUT with `{ data }`, which does not fit
 *   POST/PATCH; this family uses the `upsert` seam on `ForgejoSpec` instead of a plain create.
 *
 * ⛔ THE SECRET VALUE IS NEVER A PROP OR AN ATTRIBUTE. It is read from `FORGEJO_ORG_SECRET_{org}_{name}`
 *   (see orgSecretEnvKey) at PUT time when the name is absent from the list. Once present, reconcile
 *   noops — the API cannot confirm the value matches, and re-PUT on every deploy would rotate
 *   unintentionally. Rotate by destroy-then-create or a manual PUT outside Alchemy.
 *
 * ⛔ TOKEN NEEDS `write:organization` TO PUT — list needs `read:organization`.
 *
 * ⛔ THE FILE NAME IS PLURAL ON PURPOSE AND MUST STAY THAT WAY. `.gitignore:198` carries
 *   `*-secret.*` — the rule that stops `client-secret.json` and friends being committed — and it
 *   matches a SOURCE file called `org-secret.ts` just as happily. This family was first authored
 *   under that name: it existed on disk, typechecked, passed oxlint, was imported by alchemy.run.ts
 *   and appeared in NO `git status`. `scripts/husky/ignored-imports.ts` is the gate that now
 *   catches the class; this comment is for whoever is tempted to rename it back.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as organization from '@distilled.cloud/forgejo/organization';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { type ForgejoRequirements, type ForgejoSpec, forgejoHandlers } from './resource.ts';
import { orgSecretEnvKey } from './values.ts';

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

/** Domain refusal, not a distilled error — the env var this family reads the secret value from is unset. */
export class ForgejoSecretEnvUnsetError extends Data.TaggedError('ForgejoSecretEnvUnsetError')<{
  readonly message: string;
}> {}

const secretData = (org: string, name: string) =>
  Effect.gen(function* () {
    const key = orgSecretEnvKey(org, name);
    const raw = process.env[key];
    if (raw === undefined || raw.trim() === '') {
      return yield* Effect.fail(
        new ForgejoSecretEnvUnsetError({
          message: `${key} is unset. Export the secret value there — never as an Alchemy prop.`,
        }),
      );
    }
    return raw.trim();
  });

/** ★ EXPORTED for direct testing with an explicit fake `Credentials` layer — see repository.ts. */
export const spec: ForgejoSpec<
  OrgSecretProps,
  organization.Secret,
  OrgSecretAttributes,
  | organization.OrgListActionsSecretsError
  | organization.UpdateOrgSecretError
  | organization.DeleteOrgSecretError
  | ForgejoSecretEnvUnsetError
> = {
  attributes: (live, props) => ({
    createdAt: live.created_at,
    name: props.name,
    org: props.org,
  }),
  destroy: (props) => organization.deleteOrgSecret({ org: props.org, secretname: props.name }),
  fetchLive: (props) =>
    organization.orgListActionsSecrets({ org: props.org, limit: 200 }).pipe(
      Effect.map((rows) => rows.find((row) => row.name === props.name)),
      Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
    ),
  matches: () => true,
  upsert: (props, before) =>
    before !== undefined
      ? Effect.void
      : Effect.flatMap(secretData(props.org, props.name), (data) =>
          Effect.asVoid(
            organization.updateOrgSecret({ data, org: props.org, secretname: props.name }),
          ),
        ),
};

export const handlers = forgejoHandlers(spec);

export const ForgejoOrgSecretProvider = () =>
  Provider.effect(ForgejoOrgSecret, Effect.succeed(ForgejoOrgSecret.Provider.of(handlers)));
