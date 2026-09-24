/**
 * STUB — Traefik-specific error types. Hand-written scaffold; replaced when
 * `src/` is regenerated. Re-exports core HTTP status errors and adds the
 * unknown / parse fallbacks every Distilled package carries.
 */
export {
  API_ERRORS,
  BadGateway,
  BadRequest,
  Conflict,
  ConfigError,
  DEFAULT_ERRORS,
  Forbidden,
  GatewayTimeout,
  HTTP_STATUS_MAP,
  InternalServerError,
  Locked,
  NotFound,
  ServiceUnavailable,
  TooManyRequests,
  Unauthorized,
  UnprocessableEntity,
} from '@distilled.cloud/core/errors';
export type { DefaultErrors } from '@distilled.cloud/core/errors';

import * as Category from '@distilled.cloud/core/category';
import * as Schema from 'effect/Schema';

/** Unknown Traefik error — returned when nothing else matches the failure. */
export class UnknownTraefikError extends Schema.TaggedError<UnknownTraefikError>()(
  'UnknownTraefikError',
  {
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    body: Schema.Unknown,
  },
).pipe(Category.withServerError) {}

/** Schema parse error wrapper. */
export class TraefikParseError extends Schema.TaggedError<TraefikParseError>()('TraefikParseError', {
  body: Schema.Unknown,
  cause: Schema.Unknown,
}).pipe(Category.withParseError) {}
