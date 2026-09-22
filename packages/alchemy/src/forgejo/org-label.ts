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
 * ⚠️ THE WIRE PATH USES NUMERIC ID, NOT NAME — measured on live org labels: PATCH and DELETE are
 *   `/orgs/{org}/labels/{id}`. `locate` lists by name; `wirePath` uses the id from that row.
 *
 * ⛔ TOKEN NEEDS `write:organization` FOR RECONCILE — the mcp-read token lacks it (POST 403
 *   measured 2026-09-13). Plan/deploy needs a provision-scoped credential in `FORGEJO_TOKEN`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { forgejo } from './client.ts';
import { type ForgejoRequirements, forgejoHandlers } from './resource.ts';
import { bool, color, text } from './values.ts';

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

const handlers = forgejoHandlers<OrgLabelProps, OrgLabelAttributes>({
  attributes: (live, props) => {
    const id = live['id'];
    if (typeof id !== 'number') return undefined;
    return {
      color: color(live['color']),
      description: text(live['description']),
      exclusive: bool(live['exclusive']),
      labelId: id,
      name: props.name,
      org: props.org,
    };
  },
  collection: (props) => `orgs/${props.org}/labels`,
  createForm: (props) => ({
    color: color(props.color),
    description: props.description ?? '',
    exclusive: props.exclusive ?? false,
    name: props.name,
  }),
  locate: (props) =>
    forgejo<Record<string, unknown>[]>('GET', `orgs/${props.org}/labels?limit=200`).pipe(
      Effect.map((rows) =>
        Array.isArray(rows) ? rows.find((row) => row['name'] === props.name) : undefined,
      ),
    ),
  matches: (attributes, props) =>
    attributes.color === color(props.color) &&
    attributes.description === (props.description ?? '') &&
    attributes.exclusive === (props.exclusive ?? false),
  path: (props) => `orgs/${props.org}/labels/${props.name}`,
  updateForm: (props) => ({
    color: color(props.color),
    description: props.description ?? '',
    exclusive: props.exclusive ?? false,
  }),
  wirePath: (props, live) => `orgs/${props.org}/labels/${String(live['id'])}`,
});

export const ForgejoOrgLabelProvider = () =>
  Provider.effect(ForgejoOrgLabel, Effect.succeed(ForgejoOrgLabel.Provider.of(handlers)));
