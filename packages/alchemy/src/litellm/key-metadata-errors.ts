/**
 * The typed refusals for `LiteLLM.Key`'s `metadata` slots that carry callback credentials
 * (`logging`, `callback_settings`, `secret_manager_settings`; key-metadata.ts has the reasons).
 * Split from key-errors.ts, which is at its size cap.
 *
 * ⛔ NEITHER CARRIES A VALUE. They name the alias and the slot, never what the slot held.
 */
import * as Data from 'effect/Data';

/**
 * The declaration names a callback slot. LiteLLM stores its `callback_vars` ENCRYPTED, so the row
 * would never read back equal (every deploy would fail with `LitellmKeyFieldNotAppliedError`), and
 * Alchemy state is unencrypted.
 */
export class LitellmKeyCallbackMetadataDeclaredError extends Data.TaggedError(
  'LitellmKeyCallbackMetadataDeclaredError',
)<{
  readonly keyAlias: string;
  readonly slots: readonly string[];
}> {
  override get message(): string {
    return (
      `LiteLLM.Key '${this.keyAlias}': metadata declares ${this.slots.join(', ')}, which carry ` +
      'callback credentials. LiteLLM stores them encrypted, so they would never read back equal, ' +
      "and Alchemy state is unencrypted. Configure the key's logging in LiteLLM itself. Nothing was written."
    );
  }
}

/**
 * The live key holds callback credentials in its `metadata` and the declaration wants a metadata
 * key changed. `/key/update` REPLACES the column, and this resource never read those slots, so it
 * could not send them back: writing would strip the key's logging. Refused before the write.
 */
export class LitellmKeyCallbackMetadataLiveError extends Data.TaggedError(
  'LitellmKeyCallbackMetadataLiveError',
)<{
  readonly keyAlias: string;
  readonly slots: readonly string[];
}> {
  override get message(): string {
    return (
      `LiteLLM.Key '${this.keyAlias}': the live key holds ${this.slots.join(', ')} in its metadata ` +
      '(callback credentials this resource never reads), and /key/update replaces the whole ' +
      'metadata, so writing the declared metadata would strip them. Change that metadata in LiteLLM, ' +
      'or stop declaring metadata for this key. Nothing was written.'
    );
  }
}
