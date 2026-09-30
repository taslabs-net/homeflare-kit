/**
 * The three LiteLLM `/policies/attachments*` calls `LiteLLM.PolicyAttachment` uses, through the SDK's
 * typed operations in `@distilled.cloud/litellm/policy_engine` (LiteLLM 1.103.0):
 *
 *   list    `listPolicyAttachmentsPoliciesAttachmentsListGet`             GET    /policies/attachments/list
 *   create  `createPolicyAttachmentPoliciesAttachmentsPost`              POST   /policies/attachments
 *   delete  `deletePolicyAttachmentPoliciesAttachmentsAttachmentIdDelete` DELETE /policies/attachments/{id}
 *
 * ★ THERE IS NO UPDATE OPERATION, because the API has none (policy-attachment-types.ts). The by-id
 *   `GET` is not used either: the list carries every field and answers absence without a 404.
 * ★ THE LIST MERGES IN CONFIG-FILE ATTACHMENTS (`definition_location: "config"`, ids `config-<n>`),
 *   which the API cannot delete. `listAttachments` returns database rows only.
 * ⚠️ MOST FAILURES ARE A PLAIN 500 (`policy_endpoints.py` wraps everything in `except Exception` and
 *   answers `HTTPException(500, detail=str(e))`), and the SDK retries 5xx with backoff. The two
 *   answers that are not: a policy with no production version is a 404, and a concrete team, key or model
 *   selector that resolves to nothing is a 400 (`PolicyValidator.find_invalid_scope_entries`), so a
 *   `teams` entry must exist BEFORE its attachment: declare it as `team.teamAlias`. Wildcard patterns
 *   are let through, and may match nothing today.
 * ★ DELETE IS IDEMPOTENT BY A REAL READ: a failed DELETE (a missing id is a 404) is swallowed only when
 *   the list no longer has the id; otherwise the ORIGINAL error is re-raised.
 */
import * as policies from '@distilled.cloud/litellm/policy_engine';
import * as Effect from 'effect/Effect';
import { throughFetch } from './operations.ts';
import { isConfigRow, toAttributes } from './policy-attachment-form.ts';
import type { PolicyAttachmentAttributes } from './policy-attachment-types.ts';
import { LitellmRegistryUnreadableError } from './registry-errors.ts';
import { asRow, bodyOf } from './registry-support.ts';

const RESOURCE = 'LiteLLM.PolicyAttachment';

const unreadable = (reason: string) =>
  new LitellmRegistryUnreadableError({ reason, resource: RESOURCE });

/** Every DATABASE attachment. Config-file ones are dropped here, once. */
export const listAttachments = () =>
  throughFetch(policies.listPolicyAttachmentsPoliciesAttachmentsListGet({})).pipe(
    Effect.flatMap((response) => {
      const rows = asRow(bodyOf(response))?.['attachments'];
      if (rows === undefined) return Effect.succeed<readonly PolicyAttachmentAttributes[]>([]);
      if (!Array.isArray(rows)) return Effect.fail(unreadable('attachments is not an array'));
      const parsed = rows.filter((row) => !isConfigRow(row)).map(toAttributes);
      return parsed.every((each) => each !== undefined)
        ? Effect.succeed(parsed as readonly PolicyAttachmentAttributes[])
        : Effect.fail(unreadable('an attachment has no id or policy name'));
    }),
  );

/** The created row, which carries the id LiteLLM issued. `undefined` when the answer is not one. */
export const createAttachment = (
  body: policies.CreatePolicyAttachmentPoliciesAttachmentsPostRequest,
) =>
  throughFetch(policies.createPolicyAttachmentPoliciesAttachmentsPost(body)).pipe(
    Effect.map((response) => toAttributes(bodyOf(response))),
  );

export const deleteAttachment = (attachmentId: string) =>
  throughFetch(
    policies.deletePolicyAttachmentPoliciesAttachmentsAttachmentIdDelete({
      attachment_id: attachmentId,
    }),
  ).pipe(
    Effect.asVoid,
    Effect.catch((original) =>
      listAttachments().pipe(
        Effect.catch(() => Effect.fail(original)),
        Effect.flatMap((rows) =>
          rows.some((row) => row.attachmentId === attachmentId)
            ? Effect.fail(original)
            : Effect.void,
        ),
      ),
    ),
  );
