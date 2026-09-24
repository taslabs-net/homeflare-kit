/**
 * The typed refusals `LiteLLM.PassThroughEndpoint` raises on top of `@distilled.cloud/litellm`'s
 * own SDK errors — split out of pass-through-endpoint.ts to keep that file under the house's
 * 250-line cap once this migration added the four named SDK error-union re-exports.
 */
import type * as misc from '@distilled.cloud/litellm/misc';
import * as Data from 'effect/Data';

export class LitellmConfigPathConflictError extends Data.TaggedError(
  'LitellmConfigPathConflictError',
)<{
  readonly path: string;
}> {}
export class LitellmUnaddressableRowError extends Data.TaggedError('LitellmUnaddressableRowError')<{
  readonly path: string;
}> {}
export class LitellmLiteralSecretHeaderError extends Data.TaggedError(
  'LitellmLiteralSecretHeaderError',
)<{
  readonly headers: readonly string[];
}> {}

/**
 * ⛔ THE FOUR SDK ERROR UNIONS, NAMED, NOT `LitellmOpError` ALONE. `catchTag`'s tag-literal
 *   inference needs a concrete union to resolve `"BadRequest"`/`"NotFound"` against (the same
 *   reason `netbox/resource.ts` leaves `NotFound` folding to each resource file, not its shared
 *   engine) — `operations.ts` already returns each call's own precise per-operation error type, so
 *   this is just their union, not a re-widening.
 */
export type PassThroughEndpointError =
  | misc.GetPassThroughEndpointsConfigPassThroughEndpointGetError
  | misc.CreatePassThroughEndpointsConfigPassThroughEndpointPostError
  | misc.UpdatePassThroughEndpointsConfigPassThroughEndpointEndpointIdPostError
  | misc.DeletePassThroughEndpointsConfigPassThroughEndpointDeleteError
  | LitellmConfigPathConflictError
  | LitellmUnaddressableRowError
  | LitellmLiteralSecretHeaderError;
