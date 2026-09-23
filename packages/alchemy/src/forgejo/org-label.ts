/**
 * `Forgejo.OrgLabel` — one org-level issue label shared across every repository in the org.
 *
 * ★ RETIRES the estate's hand-run `labels-reconcile.sh`, which
 *   converged the whole `labels.yaml` file in one shot. That script CREATED and PATCHED labels
 *   from the spec and REPORTED `EXTRA` labels present live but absent from the file — it never
 *   deleted them, because removing a label strips it from every issue that carries it.
 *
 * ★ THIS RESOURCE DOES NOT REMOVE EXTRA LABELS EITHER. Alchemy manages only labels you declare;
 *   labels on the org that nobody declared stay untouched — the same boundary as the script's
 *   `EXTRA … NOT deleted` lines. Removing a declaration defaults to `retain`, so dropping a label
 *   from the stack does not DELETE it unless the caller opts into `.pipe(RemovalPolicy.destroy())`.
 *   That matches the script's never-delete posture while still allowing a deliberate destroy.
 *
 * ⚠️ THE WIRE PATH USES NUMERIC ID, NOT NAME — measured on live org labels: edit and delete are
 *   `orgEditLabel`/`orgDeleteLabel({ org, id })`. `fetchLive` lists by name; the id comes off that
 *   row for `update`/`destroy`, the same seam the hand-rolled `wirePath` used.
 *
 * ⛔ TOKEN NEEDS `write:organization` FOR RECONCILE — the mcp-read token lacks it (POST 403
 *   measured 2026-09-13). Plan/deploy needs a provision-scoped credential in `FORGEJO_TOKEN`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as organization from '@distilled.cloud/forgejo/organization';
import * as Effect from 'effect/Effect';
import { type ForgejoRequirements, forgejoHandlers } from './resource.ts';
import { color } from './values.ts';

export interface OrgLabelProps {
  /** Organization login — `homeflare` / `HomeFlare` must match the live org. */
  org: string;
  /** Label name — primary key for locate; immutable on update. */
  name: string;
  /** Six-digit hex, with or without `#`. */
  color: string;
  description?: string;
  exclusive?: boolean;
}

export interface OrgLabelAttributes {
  org: string;
  name: string;
  labelId: number;
  color: string;
  description: string;
  exclusive: boolean;
}

export interface ForgejoOrgLabel extends Resource<
  'Forgejo.OrgLabel',
  OrgLabelProps,
  OrgLabelAttributes,
  never,
  ForgejoRequirements
> {}

export const ForgejoOrgLabel = Resource<ForgejoOrgLabel>('Forgejo.OrgLabel', {
  defaultRemovalPolicy: 'retain',
});

const handlers = forgejoHandlers<
  OrgLabelProps,
  organization.Label,
  OrgLabelAttributes,
  | organization.OrgCreateLabelError
  | organization.OrgEditLabelError
  | organization.OrgDeleteLabelError
  | organization.OrgListLabelsError
>({
  attributes: (live, props) => ({
    color: color(live.color),
    description: live.description ?? '',
    exclusive: live.exclusive ?? false,
    labelId: live.id,
    name: props.name,
    org: props.org,
  }),
  create: (props) =>
    organization.orgCreateLabel({
      color: color(props.color),
      description: props.description ?? '',
      exclusive: props.exclusive ?? false,
      name: props.name,
      org: props.org,
    }),
  destroy: (props, live) => organization.orgDeleteLabel({ org: props.org, id: live.id }),
  fetchLive: (props) =>
    organization.orgListLabels({ org: props.org, limit: 200 }).pipe(
      Effect.map((rows) => rows.find((row) => row.name === props.name)),
      Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
    ),
  matches: (attributes, props) =>
    attributes.color === color(props.color) &&
    attributes.description === (props.description ?? '') &&
    attributes.exclusive === (props.exclusive ?? false),
  update: (props, live) =>
    organization.orgEditLabel({
      color: color(props.color),
      description: props.description ?? '',
      exclusive: props.exclusive ?? false,
      id: live.id,
      org: props.org,
    }),
});

export const ForgejoOrgLabelProvider = () =>
  Provider.effect(ForgejoOrgLabel, Effect.succeed(ForgejoOrgLabel.Provider.of(handlers)));
