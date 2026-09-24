/**
 * `GoogleWorkspace.OrgUnit` — one organizational unit (`admin/directory/v1/customer/{id}/orgunits`).
 *
 * ★ `orgUnitPath` IS THE IDENTITY the way `NetboxPrefix.prefix` is. Google's own doc line is
 *   copied onto `OrgUnitProps.orgUnitPath` below because it is the one field this resource cannot
 *   get wrong: it is DERIVED on read (`parentOrgUnitPath` + `name`) but AUTHORED as a full path on
 *   write, and the API's own path-parameter form drops the leading `/` (`GetOrgunitsRequest`'s
 *   `orgUnitPath` doc: "the full path … minus the leading `/`"). `values.ts`'s
 *   `stripLeadingSlash`/`withLeadingSlash` are the one place that asymmetry is handled.
 *
 * ⛔ THIS RESOURCE DOES NOT REMOVE SUB-UNITS OR MOVE USERS. Deleting an org unit that still has
 *   children or members fails server-side (Directory refuses rather than cascading) — nothing
 *   here retries around that refusal, matching S11's "observe before deleting", not "force
 *   through".
 *
 * ⛔ `defaultRemovalPolicy: 'retain'` — an org unit governs which Workspace services a user can
 *   reach (Google's own doc line on `orgUnitPath`); deleting one out from under live users is
 *   exactly the kind of hard-to-reverse action this policy exists to require an explicit opt-in
 *   for.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as directory from '@distilled.cloud/google-workspace/unstable/admin_directory_v1';
import * as Effect from 'effect/Effect';
import type { GoogleWorkspaceRequirements, GoogleWorkspaceSpec } from './resource.ts';
import { googleWorkspaceHandlers } from './resource.ts';
import { stripLeadingSlash, text, withLeadingSlash } from './values.ts';

export interface OrgUnitProps {
  /** The unique id for the Workspace account, or `my_customer` for the caller's own account. */
  customerId?: string;
  /**
   * The full path to the organizational unit, e.g. `/Contractors/2026`. Required. In order to
   * edit an `orgUnitPath`, either update `name` or `parentOrgUnitPath` — this field is derived on
   * read, not itself patchable, so declaring a different path here plans a `replace`.
   */
  orgUnitPath: string;
  /** The parent's full path, e.g. `/Contractors`. Omit for a top-level unit under `/`. */
  parentOrgUnitPath?: string;
  description?: string;
}

export interface OrgUnitAttributes {
  customerId: string;
  orgUnitPath: string;
  parentOrgUnitPath: string;
  name: string;
  description: string;
  orgUnitId: string;
}

export interface GoogleWorkspaceOrgUnit extends Resource<
  'GoogleWorkspace.OrgUnit',
  OrgUnitProps,
  OrgUnitAttributes,
  never,
  GoogleWorkspaceRequirements
> {}

export const GoogleWorkspaceOrgUnit = Resource<GoogleWorkspaceOrgUnit>('GoogleWorkspace.OrgUnit', {
  defaultRemovalPolicy: 'retain',
});

const customerOf = (props: OrgUnitProps): string => props.customerId ?? 'my_customer';
/** The path segment the API wants, split from its own leading-name component for `name`/`insert`. */
const nameOf = (props: OrgUnitProps): string =>
  props.orgUnitPath.split('/').filter(Boolean).pop() ?? props.orgUnitPath;
const parentOf = (props: OrgUnitProps): string => props.parentOrgUnitPath ?? '/';

const attributesOf = (
  live: directory.OrgUnit,
  props: OrgUnitProps,
): OrgUnitAttributes | undefined => {
  const livePath = live.orgUnitPath === undefined ? undefined : withLeadingSlash(live.orgUnitPath);
  if (livePath === undefined || livePath.toLowerCase() !== props.orgUnitPath.toLowerCase()) {
    return undefined;
  }
  return {
    customerId: customerOf(props),
    description: text(live.description),
    name: text(live.name),
    orgUnitId: text(live.orgUnitId),
    orgUnitPath: livePath,
    parentOrgUnitPath: text(live.parentOrgUnitPath),
  };
};

/** ★ EXPORTED for direct testing — see org-unit.test.ts. */
export const spec: GoogleWorkspaceSpec<
  OrgUnitProps,
  directory.OrgUnit,
  OrgUnitAttributes,
  | directory.GetOrgunitsError
  | directory.InsertOrgunitsError
  | directory.PatchOrgunitsError
  | directory.DeleteOrgunitsError
> = {
  attributes: attributesOf,
  create: (props) =>
    directory.insertOrgunits({
      body: {
        description: props.description ?? '',
        name: nameOf(props),
        parentOrgUnitPath: parentOf(props),
      },
      customerId: customerOf(props),
    }),
  describe: (props) => `customer/${customerOf(props)}/orgunits${props.orgUnitPath}`,
  destroy: (props, live) =>
    directory.deleteOrgunits({
      customerId: customerOf(props),
      orgUnitPath: stripLeadingSlash(text(live.orgUnitPath) || props.orgUnitPath),
    }),
  fetchLive: (props) =>
    directory
      .getOrgunits({
        customerId: customerOf(props),
        orgUnitPath: stripLeadingSlash(props.orgUnitPath),
      })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: (attributes, props) =>
    attributes.description === (props.description ?? '') &&
    attributes.parentOrgUnitPath === parentOf(props) &&
    attributes.name === nameOf(props),
  update: (props, live) =>
    directory.patchOrgunits({
      body: {
        description: props.description ?? '',
        name: nameOf(props),
        parentOrgUnitPath: parentOf(props),
      },
      customerId: customerOf(props),
      orgUnitPath: stripLeadingSlash(text(live.orgUnitPath) || props.orgUnitPath),
    }),
};

export const handlers = googleWorkspaceHandlers(spec);

export const GoogleWorkspaceOrgUnitProvider = () =>
  Provider.effect(
    GoogleWorkspaceOrgUnit,
    Effect.succeed(GoogleWorkspaceOrgUnit.Provider.of(handlers)),
  );
