/**
 * The `@distilled.cloud/litellm/credential_management` calls `LiteLLM.Credential` uses
 * (LiteLLM 1.103.0; names verified in the generated source, never guessed):
 *
 *   read    `getCredentialByNameCredentialsByNameCredentialNameGet`  GET     /credentials/by_name/{name}
 *   create  `createCredentialCredentialsPost`                        POST    /credentials
 *   delete  `deleteCredentialCredentialsCredentialNameDelete`        DELETE  /credentials/{name}
 *
 * ⛔ THE TYPED UPDATE OPERATION IS UNUSED, AND WHY: `updateCredentialCredentialsCredentialNamePatch`
 *   is wire-broken — measured 2026-09-30, stub fetch against this SDK, its PATCH body carries only
 *   `{credential_info, credential_values}` while the vendor's PATCH body model
 *   (`UpdateCredentialItem`, live 1.103.0 container) requires `credential_name` as a body field,
 *   so every PATCH answers 422. The whole-row rewrite a changed declaration needs is the vendor's
 *   own DELETE + POST above; credential.ts carries the reasoning. The typed fix belongs in the
 *   distilled clone; no hand-rolled HTTP here (S23).
 * ⛔ NO MESSAGE SNIFFING (S21). These operations declare only `UnprocessableEntity` (422); the
 *   `404` the read and the delete answer decodes at run time as core's shared `NotFound` class
 *   (`HTTP_STATUS_MAP`), invisible to the type checker, so absence is that class, tested with
 *   `instanceof` — never a status check, never error text. A create on a name the DB already has
 *   answers `409` (`endpoints.py`'s unique-violation handling), decoded as core `Conflict`, and is
 *   PROPAGATED: a row another writer raced in is not this declaration's row.
 * ⚠️ THE READ AND THE DELETE ASK DIFFERENT STORES (measured, `endpoints.py`): the by-name read
 *   walks the proxy's IN-MEMORY `credential_list` (a row the proxy has not loaded answers 404),
 *   while the delete consults the DATABASE (`delete_by_name`) and removes the in-memory entry
 *   after. A row present in the DB but not loaded in memory reads as ABSENT, and a create for it
 *   answers `409` — the resource reports that failure loudly instead of pretending to converge.
 * ⚠️ Unlike pass-through endpoints, each credential is its own DB row: no semaphore.
 */
import * as credentials from '@distilled.cloud/litellm/credential_management';
import { NotFound } from '@distilled.cloud/litellm/Errors';
import * as Effect from 'effect/Effect';
import { isCredentialRow, toAttributes } from './credential-form.ts';
import type { CredentialAttributes } from './credential-types.ts';
import { LitellmCredentialUnreadableError } from './credential-errors.ts';
import { type LitellmOpContext, throughFetch } from './operations.ts';

/**
 * One credential by name, or `undefined` when the proxy does not hold it in memory. ⛔ ANY FAILURE
 * OTHER THAN `NotFound` PROPAGATES: a 401, a 422 or a dead network says nothing about whether the
 * row exists, and must never be read as absence.
 */
export const readCredential = (
  credentialName: string,
): Effect.Effect<
  CredentialAttributes | undefined,
  | credentials.GetCredentialByNameCredentialsByNameCredentialNameGetError
  | LitellmCredentialUnreadableError,
  LitellmOpContext
> =>
  throughFetch(
    credentials.getCredentialByNameCredentialsByNameCredentialNameGet({
      credential_name: credentialName,
    }),
  ).pipe(
    Effect.catch((error) =>
      error instanceof NotFound ? Effect.succeed(undefined) : Effect.fail(error),
    ),
    Effect.flatMap((response) => {
      if (response === undefined) return Effect.succeed(undefined);
      if (!isCredentialRow(response)) {
        return Effect.fail(
          new LitellmCredentialUnreadableError({
            reason: 'the by-name read did not answer a credential row',
          }),
        );
      }
      const answer = String(response['credential_name']);
      // The name is re-checked on the answer: a proxy that answered some other row must never be
      // adopted as this one's.
      return answer === credentialName
        ? Effect.succeed(toAttributes(response))
        : Effect.fail(
            new LitellmCredentialUnreadableError({
              reason: 'the by-name read answered a different credential name',
            }),
          );
    }),
  );

/** POST /credentials. The answer carries no row (`{"success": true, ...}`), so the read back is the proof. */
export const createCredential = (
  body: credentials.CreateCredentialCredentialsPostRequest,
): Effect.Effect<void, credentials.CreateCredentialCredentialsPostError, LitellmOpContext> =>
  throughFetch(credentials.createCredentialCredentialsPost(body)).pipe(Effect.asVoid);

/**
 * DELETE /credentials/{name}, idempotent BY THIS FUNCTION: the vendor answers 404 for a name its
 * database does not have, which this treats as already-absent — the DB is the authoritative store
 * the delete consults (the read consults memory, see the header). Any other failure propagates.
 */
export const deleteCredential = (
  credentialName: string,
): Effect.Effect<
  void,
  credentials.DeleteCredentialCredentialsCredentialNameDeleteError,
  LitellmOpContext
> =>
  throughFetch(
    credentials.deleteCredentialCredentialsCredentialNameDelete({
      credential_name: credentialName,
    }),
  ).pipe(
    Effect.asVoid,
    Effect.catch((error) => (error instanceof NotFound ? Effect.void : Effect.fail(error))),
  );
