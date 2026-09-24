/** PVE 9.2.11 form names mapped to the generated SDK's TypeScript field names. */
import { ProxmoxParseError } from '@distilled.cloud/proxmox/Errors';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

/** Local schema refusal names the operation, never a form value (headers may be sensitive). */
export class NotificationRequestInvalid extends Data.TaggedError('NotificationRequestInvalid')<{
  readonly operation: string;
}> {}

/**
 * The provider's forms already enforce vendor constraints. This final generated-schema
 * check validates the translated Type-side fields without a cast. Unexpected family fields
 * fail explicitly instead of disappearing through the decoder's default excess-property stripping.
 */
export const notificationRequest = <S extends Schema.Top>(schema: S, fields: object) =>
  Schema.decodeUnknownEffect(Schema.toType(schema), { onExcessProperty: 'error' })(
    Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key.replaceAll('-', '_'), value]),
    ),
  ).pipe(
    Effect.mapError(() => new NotificationRequestInvalid({ operation: 'PVE notification write' })),
  );

/** Validate required response fields with the SDK schema without discarding vendor extras. */
export const notificationResponse =
  <S extends Schema.Top>(schema: S) =>
  (body: S['Type']) =>
    Schema.decodeUnknownEffect(Schema.toType(schema))(body).pipe(
      Effect.as(body),
      Effect.mapError(
        () =>
          new ProxmoxParseError({
            body: undefined,
            cause: 'PVE notification response does not match its SDK schema',
          }),
      ),
    );
