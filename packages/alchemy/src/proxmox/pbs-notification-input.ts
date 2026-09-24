/** Validate translated fields with the SDK's own schema without echoing write-only values. */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

export class PbsNotificationInputRefusal extends Data.TaggedError('PbsNotificationInputRefusal')<{
  readonly message: string;
}> {}

/**
 * Fields already use SDK Type-side names; toType validates without any wire transforms.
 * A schema diagnostic can reproduce the whole submitted form, including a webhook secret or
 * SMTP password. Sanitize only our pre-request validation failure. SDK operation errors below
 * this boundary retain their original typed tags and are never remapped.
 */
export const notificationInput = <S extends Schema.Top>(schema: S, fields: unknown) =>
  Schema.decodeUnknownEffect(Schema.toType(schema))(fields).pipe(
    Effect.mapError(
      () =>
        new PbsNotificationInputRefusal({
          message:
            'PBS notification fields do not match the SDK request schema; no PBS request was sent.',
        }),
    ),
  );
