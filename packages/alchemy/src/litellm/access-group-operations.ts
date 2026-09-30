/**
 * The four LiteLLM `/v1/unified_access_group*` calls `LiteLLM.AccessGroup` uses, through the SDK's
 * typed operations in `@distilled.cloud/litellm/access_groups` (LiteLLM 1.103.0):
 *
 *   list    `listAccessGroupsV1UnifiedAccessGroupGet`                     GET    /v1/unified_access_group
 *   create  `createAccessGroupV1UnifiedAccessGroupPost`                   POST   /v1/unified_access_group
 *   update  `updateAccessGroupV1UnifiedAccessGroupAccessGroupIdPut`       PUT    /v1/unified_access_group/{id}
 *   delete  `deleteAccessGroupV1UnifiedAccessGroupAccessGroupIdDelete`    DELETE /v1/unified_access_group/{id}
 *
 * `/v1/unified_access_group` is registered as an alias of `/v1/access_group` on the same handlers
 * (`access_group_endpoints.py`, the "Alias routes" block), so the two answer identically.
 * The by-id `GET` is not used: a missing id is a 404 this tag does not declare, and the list decides
 * absence without depending on it.
 *
 * ⛔ WRITES NEED PROXY_ADMIN (`_require_proxy_admin`, 403 otherwise) and READS need admin or admin-view
 *   (`_require_admin_view`). A key that can only read sees every group and can change none.
 * ⛔ NO MESSAGE SNIFFING. Nothing here reads a status or message. `create` of a name that exists is a
 *   409 LiteLLM raises itself; the SDK does not declare it for this tag, so it reaches the caller as
 *   the SDK's own error, unchanged. `create` runs only after a list showed the name absent, so a 409
 *   means a concurrent create, which is a failure to report, not to paper over.
 * ★ DELETE IS IDEMPOTENT BY A REAL READ (the budget and pass-through rule): a failed DELETE is
 *   swallowed only when the list no longer has the id. A 403 for lack of rights leaves the row
 *   live, so it re-raises the ORIGINAL error.
 * ⚠️ DELETING A GROUP DETACHES IT FROM EVERY TEAM AND KEY (`delete_access_group` rewrites their
 *   `access_group_ids`), which is why the resource defaults to `retain`.
 */
import * as ag from '@distilled.cloud/litellm/access_groups';
import * as Effect from 'effect/Effect';
import { type LitellmOpContext, throughFetch } from './operations.ts';
import { LitellmRegistryUnreadableError } from './registry-errors.ts';
import { bodyOf } from './registry-support.ts';
import { type AccessGroupAttributes } from './access-group-types.ts';
import { toAttributes } from './access-group-form.ts';

const RESOURCE = 'LiteLLM.AccessGroup';

/** Every group. The list is the table (`AccessGroupRepository(...).table.find_many`), not a registry. */
export const listAccessGroups = (): Effect.Effect<
  readonly AccessGroupAttributes[],
  ag.ListAccessGroupsV1UnifiedAccessGroupGetError | LitellmRegistryUnreadableError,
  LitellmOpContext
> =>
  throughFetch(ag.listAccessGroupsV1UnifiedAccessGroupGet({})).pipe(
    Effect.flatMap((response) => {
      const rows: unknown = bodyOf(response);
      if (!Array.isArray(rows)) {
        return Effect.fail(
          new LitellmRegistryUnreadableError({ reason: 'not an array', resource: RESOURCE }),
        );
      }
      const parsed = rows.map(toAttributes);
      return parsed.every((row) => row !== undefined)
        ? Effect.succeed(parsed as readonly AccessGroupAttributes[])
        : Effect.fail(
            new LitellmRegistryUnreadableError({
              reason: 'a row has no id or name',
              resource: RESOURCE,
            }),
          );
    }),
  );

export const createAccessGroup = (body: ag.CreateAccessGroupV1UnifiedAccessGroupPostRequest) =>
  throughFetch(ag.createAccessGroupV1UnifiedAccessGroupPost(body)).pipe(Effect.asVoid);

export const updateAccessGroup = (
  accessGroupId: string,
  body: Omit<ag.UpdateAccessGroupV1UnifiedAccessGroupAccessGroupIdPutRequest, 'access_group_id'>,
) =>
  throughFetch(
    ag.updateAccessGroupV1UnifiedAccessGroupAccessGroupIdPut({
      ...body,
      access_group_id: accessGroupId,
    }),
  ).pipe(Effect.asVoid);

export const deleteAccessGroup = (accessGroupId: string) =>
  throughFetch(
    ag.deleteAccessGroupV1UnifiedAccessGroupAccessGroupIdDelete({ access_group_id: accessGroupId }),
  ).pipe(
    Effect.asVoid,
    Effect.catch((original) =>
      listAccessGroups().pipe(
        Effect.catch(() => Effect.fail(original)),
        Effect.flatMap((rows) =>
          rows.some((row) => row.accessGroupId === accessGroupId)
            ? Effect.fail(original)
            : Effect.void,
        ),
      ),
    ),
  );
