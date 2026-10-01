/**
 * The typed refusals `LiteLLM.Model` raises on top of `@distilled.cloud/litellm`'s own SDK errors.
 *
 * ⛔ NO MESSAGE HERE MAY CARRY A CREDENTIAL: only names, ids, field names and the NAME of an
 *   environment variable, exactly like mcp-server-errors.ts.
 */
import type { BadRequest, NotFound } from '@distilled.cloud/litellm/Errors';
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
 * The write returned no error but the deployment still differs from the declaration. The PATCH
 * merge writes the keys it was sent (`update_db_model` at v1.103.0); a field the read-back still
 * shows different is refused here instead of being reported as converged.
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

/**
 * A reconcile with no state found a live row under the declared name whose id is not the one this
 * declaration would create, and nothing vouchsafes it: writing over it would take over another
 * owner's deployment. `replace` says whether this generation is a replace's new identity (a changed
 * declared id), which `--adopt` does not cover — the object must be removed first.
 */
export class LitellmModelForeignRowError extends Data.TaggedError('LitellmModelForeignRowError')<{
  readonly modelName: string;
  readonly id: string;
  readonly replace: boolean;
}> {
  override get message(): string {
    const remedy = this.replace
      ? 'It is the new identity of a replace, which --adopt does not cover: remove it first.'
      : 'Deploy with --adopt to take it over, or remove it first.';
    return (
      `LiteLLM.Model "${this.modelName}": the live row ${this.id} already exists and this stack ` +
      `holds no state for it. Nothing was written. ${remedy}`
    );
  }
}

/**
 * The row a reconcile found is served from the proxy's config file (`model_info.db_model: false`),
 * not from the database, so the DB API cannot manage it. Remove it from the config file first.
 */
/**
 * The live row a stateless reconcile found is an OLDER generation of this FQN's own state chain
 * (`attr.id` walked through `old`). It is still the serving deployment: the replacement that
 * followed it never committed. Taking the row over would store that id on the new generation, and
 * `destroy()` then deletes the old generation by the same id.
 * ⛔ THE RECOVERY IS STATE, NOT THE ROW. `alchemy state rm` deletes the state record and leaves the
 *   deployment; deleting the live row takes the serving model out of its group.
 */
export class LitellmModelPriorGenerationError extends Data.TaggedError(
  'LitellmModelPriorGenerationError',
)<{
  readonly modelName: string;
  readonly id: string;
  readonly fqn: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.Model "${this.modelName}": the live row ${this.id} is an older generation still ` +
      `recorded on ${this.fqn}. Nothing was written. Taking it over would store that id on the ` +
      'in-flight replacement, and destroy() then deletes the old generation by the same id. ' +
      "Drop this resource's state row (alchemy state rm, which leaves the deployment) and " +
      'deploy again with --adopt. Do not delete the live row.'
    );
  }
}

export class LitellmModelConfigFileRowError extends Data.TaggedError(
  'LitellmModelConfigFileRowError',
)<{
  readonly modelName: string;
  readonly id: string;
}> {
  override get message(): string {
    return (
      `LiteLLM.Model "${this.modelName}": the live row ${this.id} is served from the proxy's ` +
      'config file (db_model: false), not from the database, so the DB API cannot manage it. ' +
      'Remove it from the config file first.'
    );
  }
}

export type ModelError =
  | models.AddNewModelModelNewPostError
  | models.DeleteModelModelDeletePostError
  | models.GetModelInfoV1ModelInfoError
  | models.PatchModelModelModelIdUpdatePatchError
  | BadRequest
  | NotFound
  | LitellmModelInvalidError
  | LitellmModelAmbiguousNameError
  | LitellmModelUnreadableError
  | LitellmModelAbsentAfterWriteError
  | LitellmModelNotConvergedError
  | LitellmModelForeignRowError
  | LitellmModelPriorGenerationError
  | LitellmModelConfigFileRowError;
