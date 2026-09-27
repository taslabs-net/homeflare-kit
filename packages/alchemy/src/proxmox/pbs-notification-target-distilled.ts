/**
 * PBS 4.2.6-1 notification operations, generated from its vendor schema in SDK 0.3.0.
 *
 * ★ Keep targetForm's selective secret groups and deletion semantics. The SDK schemas validate
 *   the spelling adapter before their typed operations encode it; no request shape is cast.
 *   Only the SDK's NotFound is absence. An unreadable target must stop adoption, not create it.
 */
import * as config from '@distilled.cloud/proxmox-backup/config';
import type {
  ProxmoxBackupOpContext,
  ProxmoxBackupOpError,
} from '@distilled.cloud/proxmox-backup/Protocol';
import * as Effect from 'effect/Effect';
import { notificationInput } from './pbs-notification-input.ts';
import type { PveForm } from './client.ts';
import { runPbs } from './distilled-pbs.ts';
import type { PbsNotificationTargetProps as Props } from './pbs-notification-target.ts';
import { targetAttributes } from './pbs-notification-target-wire.ts';

/** SDK property names differ from the vendor's form keys only at these two fields. */
const requestFields = (props: Props, form: PveForm) => ({
  ...form,
  from_address: form['from-address'],
  mailto_user: form['mailto-user'],
  name: props.name,
});

const read = (
  props: Props,
): Effect.Effect<Record<string, unknown>, ProxmoxBackupOpError, ProxmoxBackupOpContext> => {
  switch (props.type) {
    case 'sendmail':
      return config.getConfigNotificationEndpointSendmail({ name: props.name }).pipe(
        Effect.map((row) => ({
          ...row,
          'from-address': row.from_address,
          'mailto-user': row.mailto_user,
        })),
      );
    case 'smtp':
      return config.getConfigNotificationEndpointSmtp({ name: props.name }).pipe(
        Effect.map((row) => ({
          ...row,
          'from-address': row.from_address,
          'mailto-user': row.mailto_user,
        })),
      );
    case 'webhook':
      return config
        .getConfigNotificationEndpointWebhook({ name: props.name })
        .pipe(Effect.map((row) => ({ ...row })));
  }
};

export const readTarget = (props: Props) =>
  runPbs(props.target, 'read', read(props)).pipe(
    Effect.map((row) => targetAttributes(row, props)),
    Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
  );

/** No request: run the same translated-input validation before replacement can delete anything. */
export const validateTargetWrite = (props: Props, form: PveForm, mode: 'create' | 'update') => {
  const schema =
    mode === 'create'
      ? {
          sendmail: config.CreateConfigNotificationEndpointSendmailRequest,
          smtp: config.CreateConfigNotificationEndpointSmtpRequest,
          webhook: config.CreateConfigNotificationEndpointWebhookRequest,
        }[props.type]
      : {
          sendmail: config.PutConfigNotificationEndpointSendmailRequest,
          smtp: config.PutConfigNotificationEndpointSmtpRequest,
          webhook: config.PutConfigNotificationEndpointWebhookRequest,
        }[props.type];
  return notificationInput(schema, requestFields(props, form)).pipe(Effect.asVoid);
};

export const createTarget = (props: Props, form: PveForm) => {
  const fields = requestFields(props, form);
  const operation =
    props.type === 'sendmail'
      ? notificationInput(config.CreateConfigNotificationEndpointSendmailRequest, fields).pipe(
          Effect.flatMap(config.createConfigNotificationEndpointSendmail),
        )
      : props.type === 'smtp'
        ? notificationInput(config.CreateConfigNotificationEndpointSmtpRequest, fields).pipe(
            Effect.flatMap(config.createConfigNotificationEndpointSmtp),
          )
        : notificationInput(config.CreateConfigNotificationEndpointWebhookRequest, fields).pipe(
            Effect.flatMap(config.createConfigNotificationEndpointWebhook),
          );
  return runPbs(props.target, 'provision', operation);
};

export const updateTarget = (props: Props, form: PveForm) => {
  const fields = requestFields(props, form);
  const operation =
    props.type === 'sendmail'
      ? notificationInput(config.PutConfigNotificationEndpointSendmailRequest, fields).pipe(
          Effect.flatMap(config.putConfigNotificationEndpointSendmail),
        )
      : props.type === 'smtp'
        ? notificationInput(config.PutConfigNotificationEndpointSmtpRequest, fields).pipe(
            Effect.flatMap(config.putConfigNotificationEndpointSmtp),
          )
        : notificationInput(config.PutConfigNotificationEndpointWebhookRequest, fields).pipe(
            Effect.flatMap(config.putConfigNotificationEndpointWebhook),
          );
  return runPbs(props.target, 'provision', operation);
};

/** Built-ins still follow PBS's revert-on-delete semantics; missing objects are already deleted. */
export const deleteTarget = (props: Props) => {
  const request = { name: props.name };
  const operation =
    props.type === 'sendmail'
      ? config.deleteConfigNotificationEndpointSendmail(request)
      : props.type === 'smtp'
        ? config.deleteConfigNotificationEndpointSmtp(request)
        : config.deleteConfigNotificationEndpointWebhook(request);
  return runPbs(props.target, 'provision', operation).pipe(
    Effect.catchTag('NotFound', () => Effect.void),
  );
};
