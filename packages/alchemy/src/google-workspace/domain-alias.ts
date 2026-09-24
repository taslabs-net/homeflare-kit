/**
 * `GoogleWorkspace.DomainAlias` — one secondary-domain alias on the Workspace account
 * (`admin/directory/v1/customer/{customer}/domainaliases`).
 *
 * ⛔ NO `update` OPERATION EXISTS. The Directory API ships `get`/`insert`/`delete`/`list` for
 *   domain aliases and nothing else — measured against `admin_directory_v1.ts`: there is no
 *   `patchDomainAliases` or `updateDomainAliases`. `spec.update` is intentionally absent, so
 *   `resource.ts`'s `diff` reports `replace` for any drift rather than an unsendable PATCH — the
 *   same fallback NetBox's `netboxOperations` and Forgejo's `forgejoOperations` give a spec with
 *   no `update`.
 *
 * ★ `domainAliasName` IS THE WHOLE IDENTITY. `parentDomainName` only matters at create time —
 *   Google refuses reparenting an alias in place, so a declared `parentDomainName` that no longer
 *   matches the live row is exactly the identity change `replace` exists for.
 *
 * ⚠️ THE HOUSE'S CLOUDFLARE ZONES (`homeflare.dev`, `aimto.app`, `schenanigans.com`, `taslabs.net`
 *   — `site/live.site.json` in homeflare-landscape) are DNS zones, not Workspace domains by
 *   themselves; a zone only becomes a valid `parentDomainName` once it is added and verified as a
 *   primary or secondary domain in the Workspace admin console. This family does not verify a
 *   domain — Google's verification is a TXT/CNAME challenge outside the Directory API's write
 *   surface — so `create` will fail with `BadRequest` against an unverified domain, which is
 *   correct: nothing here should silently paper over a step the account owner has to do by hand.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as directory from '@distilled.cloud/google-workspace/unstable/admin_directory_v1';
import * as Effect from 'effect/Effect';
import type { GoogleWorkspaceRequirements, GoogleWorkspaceSpec } from './resource.ts';
import { googleWorkspaceHandlers } from './resource.ts';
import { bool, ciEqual, text } from './values.ts';

export interface DomainAliasProps {
  /** The unique id for the Workspace account, or `my_customer` for the caller's own account. */
  customer?: string;
  /** The alias domain name — primary key for locate. */
  domainAliasName: string;
  /** The primary or secondary domain this alias resolves to. Immutable — a change replaces. */
  parentDomainName: string;
}

export interface DomainAliasAttributes {
  customer: string;
  domainAliasName: string;
  parentDomainName: string;
  /** Read-only. */
  verified: boolean;
  /** Read-only, ISO-ish epoch-ms string as Google returns it. */
  creationTime: string;
}

export interface GoogleWorkspaceDomainAlias extends Resource<
  'GoogleWorkspace.DomainAlias',
  DomainAliasProps,
  DomainAliasAttributes,
  never,
  GoogleWorkspaceRequirements
> {}

export const GoogleWorkspaceDomainAlias = Resource<GoogleWorkspaceDomainAlias>(
  'GoogleWorkspace.DomainAlias',
  { defaultRemovalPolicy: 'retain' },
);

const customerOf = (props: DomainAliasProps): string => props.customer ?? 'my_customer';

const attributesOf = (
  live: directory.DomainAlias,
  props: DomainAliasProps,
): DomainAliasAttributes | undefined => {
  if (live.domainAliasName === undefined || !ciEqual(live.domainAliasName, props.domainAliasName)) {
    return undefined;
  }
  return {
    creationTime: text(live.creationTime),
    customer: customerOf(props),
    domainAliasName: live.domainAliasName,
    parentDomainName: text(live.parentDomainName),
    verified: bool(live.verified),
  };
};

/** ★ EXPORTED for direct testing — see domain-alias.test.ts. */
export const spec: GoogleWorkspaceSpec<
  DomainAliasProps,
  directory.DomainAlias,
  DomainAliasAttributes,
  | directory.GetDomainAliasesError
  | directory.InsertDomainAliasesError
  | directory.DeleteDomainAliasesError
> = {
  attributes: attributesOf,
  create: (props) =>
    directory.insertDomainAliases({
      body: { domainAliasName: props.domainAliasName, parentDomainName: props.parentDomainName },
      customer: customerOf(props),
    }),
  describe: (props) => `customer/${customerOf(props)}/domainaliases/${props.domainAliasName}`,
  destroy: (props, live) =>
    directory.deleteDomainAliases({
      customer: customerOf(props),
      domainAliasName: text(live.domainAliasName) || props.domainAliasName,
    }),
  fetchLive: (props) =>
    directory
      .getDomainAliases({ customer: customerOf(props), domainAliasName: props.domainAliasName })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: (attributes, props) => attributes.parentDomainName === props.parentDomainName,
};

export const handlers = googleWorkspaceHandlers(spec);

export const GoogleWorkspaceDomainAliasProvider = () =>
  Provider.effect(
    GoogleWorkspaceDomainAlias,
    Effect.succeed(GoogleWorkspaceDomainAlias.Provider.of(handlers)),
  );
