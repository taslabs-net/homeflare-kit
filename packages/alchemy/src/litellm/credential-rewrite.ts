/** Whole-row removal needs a diagnostic that remembers DELETE succeeded before POST failed. */
import type { API_ERRORS } from '@distilled.cloud/litellm/Errors';
import type * as credentials from '@distilled.cloud/litellm/credential_management';
import * as Effect from 'effect/Effect';
import {
  LitellmCredentialRewriteError,
  type LitellmCredentialTransportError,
} from './credential-errors.ts';
import { createCredential, deleteCredential } from './credential-operations.ts';
import type { LitellmOpContext } from './operations.ts';

export const rewriteCredential = (body: credentials.CreateCredentialCredentialsPostRequest) =>
  Effect.gen(function* () {
    const credentialName = body.credential_name;
    yield* deleteCredential(credentialName);
    // The SDK's status fallback can emit every API_ERRORS member, including statuses absent
    // from this operation's generated union. Keep only its tag, never a body/message/cause.
    const post: Effect.Effect<
      void,
      | credentials.CreateCredentialCredentialsPostError
      | LitellmCredentialTransportError
      | InstanceType<(typeof API_ERRORS)[number]>,
      LitellmOpContext
    > = createCredential(body);
    yield* post.pipe(
      Effect.catchTag(
        [
          'BadGateway',
          'BadRequest',
          'ConfigError',
          'Conflict',
          'Forbidden',
          'GatewayTimeout',
          'HttpClientError',
          'InternalServerError',
          'LitellmCredentialTransportError',
          'LitellmParseError',
          'Locked',
          'NotFound',
          'ServiceUnavailable',
          'TooManyRequests',
          'Unauthorized',
          'UnknownLitellmError',
          'UnprocessableEntity',
        ],
        (error) =>
          Effect.fail(new LitellmCredentialRewriteError({ credentialName, reason: error._tag })),
      ),
    );
  });
