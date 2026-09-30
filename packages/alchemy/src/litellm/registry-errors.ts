/**
 * The typed refusals the LiteLLM registry resources (`LiteLLM.Team`, `AccessGroup`, `Toolset`,
 * `Policy`, `PolicyAttachment`, `ToolPolicy`) raise on top of `@distilled.cloud/litellm`'s own SDK
 * errors. One small set, tagged with the resource it came from, so a stack's error handling does not
 * grow six near-identical classes.
 *
 * ⛔ NO MESSAGE HERE MAY CARRY A CREDENTIAL. What is named: the resource type, the declared name or
 *   id, ids the proxy already lists, and field names. Never a description (free text a person wrote)
 *   and never a request body.
 */
import * as Data from 'effect/Data';

/** A declaration the resource refuses before any request: a combination nobody meant. */
export class LitellmRegistryInvalidError extends Data.TaggedError('LitellmRegistryInvalidError')<{
  readonly resource: string;
  readonly name: string;
  readonly problem: string;
}> {
  override get message(): string {
    return `${this.resource} "${this.name}": ${this.problem}.`;
  }
}

/** A list or read answered something that is not the rows this resource expects. */
export class LitellmRegistryUnreadableError extends Data.TaggedError(
  'LitellmRegistryUnreadableError',
)<{
  readonly resource: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.resource}: the proxy's answer is unreadable (${this.reason}).`;
  }
}

/**
 * More than one live row could be the declared one, so adopting by name cannot say which. Nothing is
 * adopted, updated or deleted on a guess: declare the id to choose one.
 */
export class LitellmRegistryAmbiguousError extends Data.TaggedError(
  'LitellmRegistryAmbiguousError',
)<{
  readonly resource: string;
  readonly name: string;
  readonly ids: readonly string[];
}> {
  override get message(): string {
    return (
      `${this.resource} "${this.name}": ${this.ids.length} live rows match (${this.ids.join(', ')}). ` +
      'Declare the id to choose one.'
    );
  }
}

/** A write returned no error, yet the row is not there on the read back. */
export class LitellmRegistryAbsentAfterWriteError extends Data.TaggedError(
  'LitellmRegistryAbsentAfterWriteError',
)<{
  readonly resource: string;
  readonly name: string;
}> {
  override get message(): string {
    return `${this.resource} "${this.name}": the write returned no error but the row is absent on the read back.`;
  }
}

/**
 * A write returned no error, yet the row still differs from the declaration. The route may merge with
 * `exclude_none` or a truthiness check; the read back says so instead of reporting a converged row.
 */
export class LitellmRegistryNotConvergedError extends Data.TaggedError(
  'LitellmRegistryNotConvergedError',
)<{
  readonly resource: string;
  readonly name: string;
  readonly fields: readonly string[];
}> {
  override get message(): string {
    return `${this.resource} "${this.name}": after the write, the row still differs in ${this.fields.join(', ')}.`;
  }
}

export type RegistryError =
  | LitellmRegistryInvalidError
  | LitellmRegistryUnreadableError
  | LitellmRegistryAmbiguousError
  | LitellmRegistryAbsentAfterWriteError
  | LitellmRegistryNotConvergedError;
