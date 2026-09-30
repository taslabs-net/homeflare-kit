/**
 * The typed refusals `LiteLLM.Model` raises on top of `@distilled.cloud/litellm`'s own SDK errors.
 *
 * ⛔ NO MESSAGE HERE MAY CARRY A CREDENTIAL: only names, ids, field names and the NAME of an
 *   environment variable, exactly like mcp-server-errors.ts.
 */
import type * as models from '@distilled.cloud/litellm/model_management';
import * as Data from 'effect/Data';

/** A declaration the resource refuses before any request: a combination nobody meant. */
export class LitellmModelInvalidError extends Data.TaggedError('LitellmModelInvalidError')<{
  readonly modelName: string;
  readonly problem: string;
}> {
  override get message(): string {
    return `LiteLLM.Model "${this.modelName}": ${this.problem}.`;
  }
}

/**
 * More than one live deployment carries the declared `model_name`, so adopt-by-name cannot say
 * which one is meant — LiteLLM runs several deployments under one group name on purpose. Declare
 * `id` to pick one; nothing is adopted, updated or deleted on a guess.
 */
export class LitellmModelAmbiguousNameError extends Data.TaggedError(
  'LitellmModelAmbiguousNameError',
)<{
  readonly modelName: string;
  readonly ids: readonly string[];
}> {
  override get message(): string {
    return (
      `LiteLLM.Model "${this.modelName}": ${this.ids.length} live deployments carry that name ` +
      `(${this.ids.join(', ')}). Declare \`id\` to choose one.`
    );
  }
}

/** `GET /model/info` answered something that is not a list of deployments. */
export class LitellmModelUnreadableError extends Data.TaggedError('LitellmModelUnreadableError')<{
  readonly reason: string;
}> {
  override get message(): string {
    return `LiteLLM.Model: the deployment list is unreadable (${this.reason}).`;
  }
}

/**
 * A create or update returned no error, yet no read answers a deployment with the id it was written
 * under: not in the list, and not by the id it would carry.
 */
export class LitellmModelAbsentAfterWriteError extends Data.TaggedError(
  'LitellmModelAbsentAfterWriteError',
)<{
  readonly modelName: string;
  readonly id: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.Model "${this.modelName}": the write of ${this.id} returned no error but the ` +
      'deployment is absent from the list and from the by-id read.'
    );
  }
}

/**
 * The write returned no error but the deployment still differs from the declaration. `/model/update`
 * is a partial update (assigned keys only, read from the 1.103.0 source), so what did not land is
 * refused here instead of being reported as converged.
 */
export class LitellmModelNotConvergedError extends Data.TaggedError(
  'LitellmModelNotConvergedError',
)<{
  readonly modelName: string;
  readonly id: string;
  readonly fields: readonly string[];
}> {
  override get message(): string {
    return (
      `LiteLLM.Model "${this.modelName}": after the write, ${this.id} still differs from the ` +
      `declaration in ${this.fields.join(', ')}.`
    );
  }
}

export type ModelError =
  | models.AddNewModelModelNewPostError
  | models.DeleteModelModelDeletePostError
  | models.GetModelInfoV1ModelInfoError
  | models.UpdateModelModelUpdatePostError
  | LitellmModelInvalidError
  | LitellmModelAmbiguousNameError
  | LitellmModelUnreadableError
  | LitellmModelAbsentAfterWriteError
  | LitellmModelNotConvergedError;
