/**
 * The `@distilled.cloud/litellm/credential_management` calls `LiteLLM.Credential` uses
 * (LiteLLM 1.103.0; names verified in the generated source, never guessed):
 *
 *   read    `getCredentialByNameCredentialsByNameCredentialNameGet`  GET     /credentials/by_name/{name}
 *   create  `createCredentialCredentialsPost`                        POST    /credentials
 *   update  `updateCredentialCredentialsCredentialNamePatch`        PATCH   /credentials/{name}
 *   delete  `deleteCredentialCredentialsCredentialNameDelete`        DELETE  /credentials/{name}
 *
 * ★ THE UPDATE IS A PATCH, NOT A REWRITE. The vendor's PATCH merges by key
 *   (`update_db_credential`), and the body carries `credential_name` as a second member
 *   (`credential_name_body`, wire-named `credential_name`) because the vendor's
 *   `UpdateCredentialItem` requires it in the body and a Smithy member has one binding — the
 *   distilled patch `patches/credential_management/update_credential_credentials__credential_name__patch.json`.
 *   A PATCH that fails on the wire leaves the row it was merging into, where the old DELETE + POST
 *   rewrite left NO row when the POST failed after the DELETE (review finding 3). credential.ts
 *   still rewrites a whole row for the one thing PATCH cannot do — remove a key.
 * ⛔ NO MESSAGE SNIFFING (S21). The read's and delete's `404` is typed as the SDK's
 *   `CredentialNotFound` (a distilled patch matched on the vendor's "Credential not found" message,
 *   `endpoints.py`), so absence is that TAG, `catchTag`ed — never `instanceof`, never error text. A
 *   404 from a front proxy, Access, or a wrong base path decodes as core's `NotFound` and stays an
 *   error, never absence. A create on a name the DB already has answers `409` (`endpoints.py`'s
 *   unique-violation handling), decoded as core `Conflict`, and is PROPAGATED: a row another writer
 *   raced in is not this declaration's row. The PATCH's own 404 (message `Credential not found in
 *   DB.`) is NOT `CredentialNotFound`: it stays core `NotFound`, an error — a row deleted between
 *   the read and the PATCH must not silently read as absence.
 * ⚠️ THE READ AND THE DELETE ASK DIFFERENT STORES (measured, `endpoints.py`): the by-name read
 *   walks the proxy's IN-MEMORY `credential_list` (a row the proxy has not loaded answers 404),
 *   while the delete consults the DATABASE (`delete_by_name`) and removes the in-memory entry
 *   after. A row present in the DB but not loaded in memory reads as ABSENT, and a create for it
 *   answers `409` — the resource reports that failure loudly instead of pretending to converge.
 * ⚠️ Unlike pass-through endpoints, each credential is its own DB row: no semaphore.
 */
import * as credentials from '@distilled.cloud/litellm/credential_management';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import { isHttpClientError } from 'effect/unstable/http/HttpClientError';
import { isCredentialRow, toAttributes } from './credential-form.ts';
import type { CredentialAttributes } from './credential-types.ts';
import {
  LitellmCredentialDebugLoggingError,
  LitellmCredentialTransportError,
  LitellmCredentialUnreadableError,
} from './credential-errors.ts';
import { type LitellmOpContext, throughFetch } from './operations.ts';

/**
 * One credential by name, or `undefined` when the proxy does not hold it in memory. ⛔ ANY FAILURE
 * OTHER THAN `CredentialNotFound` PROPAGATES: a 401, a 422 or a dead network says nothing about
 * whether the row exists, and must never be read as absence.
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
    Effect.catchTag('CredentialNotFound', () => Effect.succeed(undefined)),
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

/**
 * POST /credentials. The answer carries no row (`{"success": true, ...}`), so the read back is the
 * proof.
 *
 * ⛔ THE REQUEST BODY CARRIES THE VALUES, AND A FAILED CALL CAN CARRY ITS REQUEST — exactly the
 *   `{"key":"sk-…"}` leak `generateKey` (key-operations.ts) closes, and it is closed the same way:
 *   a transport failure is an `HttpClientError` in the error channel, a body that fails mid-read is
 *   the SAME error as a DEFECT (`Effect.orDie` in core's `protocol-rest.ts`). Both become
 *   `LitellmCredentialTransportError`, which keeps the NAME and the reason's tag and nothing else.
 * ⛔ REFUSED WHILE `DISTILLED_DEBUG_HTTP` IS SET, before any request: the SDK prints the first 400
 *   characters of every request body (core `protocol-http.ts`), which would put the values on
 *   stderr — the same refusal `key-secret.ts` makes for `/key/generate`.
 */
export const createCredential = (
  body: credentials.CreateCredentialCredentialsPostRequest,
): Effect.Effect<
  void,
  | credentials.CreateCredentialCredentialsPostError
  | LitellmCredentialTransportError
  | LitellmCredentialDebugLoggingError,
  LitellmOpContext
> => {
  const credentialName = body.credential_name ?? '';
  return Effect.gen(function* () {
    yield* refuseDebugLogging(credentialName);
    yield* throughFetch(credentials.createCredentialCredentialsPost(body)).pipe(
      Effect.asVoid,
      Effect.catchTag('HttpClientError', (error) =>
        Effect.fail(
          new LitellmCredentialTransportError({ credentialName, reason: error.reason._tag }),
        ),
      ),
      Effect.catchDefect((defect) =>
        carriesRequest(defect)
          ? Effect.fail(
              new LitellmCredentialTransportError({
                credentialName,
                reason: isHttpClientError(defect) ? defect.reason._tag : 'Defect',
              }),
            )
          : Effect.die(defect),
      ),
    );
  });
};

/**
 * PATCH /credentials/{name}. Merges the declared `credential_info` and (when present) the resolved
 * `credential_values` into the live row; the answer carries no row (`{"success": true, ...}`), so
 * the read back is the proof.
 *
 * ⛔ THE SAME TWO GUARDS AS `createCredential`: the body carries the values, so a transport failure
 *   becomes a `LitellmCredentialTransportError` that keeps the NAME and the reason's tag and
 *   nothing else, and the call is refused while `DISTILLED_DEBUG_HTTP` is set (the SDK would print
 *   the values). A PATCH that fails on the wire leaves the row in place — the point of using it
 *   over a DELETE + POST rewrite.
 */
export const updateCredential = (
  body: credentials.UpdateCredentialCredentialsCredentialNamePatchRequest,
): Effect.Effect<
  void,
  | credentials.UpdateCredentialCredentialsCredentialNamePatchError
  | LitellmCredentialTransportError
  | LitellmCredentialDebugLoggingError,
  LitellmOpContext
> => {
  const credentialName = body.credential_name ?? '';
  return Effect.gen(function* () {
    yield* refuseDebugLogging(credentialName);
    yield* throughFetch(credentials.updateCredentialCredentialsCredentialNamePatch(body)).pipe(
      Effect.asVoid,
      Effect.catchTag('HttpClientError', (error) =>
        Effect.fail(
          new LitellmCredentialTransportError({ credentialName, reason: error.reason._tag }),
        ),
      ),
      Effect.catchDefect((defect) =>
        carriesRequest(defect)
          ? Effect.fail(
              new LitellmCredentialTransportError({
                credentialName,
                reason: isHttpClientError(defect) ? defect.reason._tag : 'Defect',
              }),
            )
          : Effect.die(defect),
      ),
    );
  });
};

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
    Effect.catchTag('CredentialNotFound', () => Effect.void),
  );

/**
 * Whether `DISTILLED_DEBUG_HTTP` is set, refused by `createCredential` and `updateCredential`
 * before any request (both bodies carry the values). Reads `process.env` because that is what the
 * SDK's `protocol-http.ts` reads.
 */
const refuseDebugLogging = (
  credentialName: string,
): Effect.Effect<void, LitellmCredentialDebugLoggingError> =>
  (globalThis.process?.env?.['DISTILLED_DEBUG_HTTP'] ?? '') !== ''
    ? Effect.fail(new LitellmCredentialDebugLoggingError({ credentialName }))
    : Effect.void;

/** An `HttpClientError` (or a defect that is one) carries its request — and thus the values. */
const carriesRequest = (value: unknown): boolean =>
  isHttpClientError(value) || Predicate.hasProperty(value, 'request');
