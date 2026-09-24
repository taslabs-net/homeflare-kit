/** PVE 9.2.11 target operations. Named SDK calls retain each endpoint's own request schema. */
import * as cluster from '@distilled.cloud/proxmox/cluster';
import type { ProxmoxOpContext, ProxmoxOpError } from '@distilled.cloud/proxmox/Protocol';
import * as Effect from 'effect/Effect';
import { runPve } from './distilled-pve.ts';
import type { NotificationTargetProps as Props } from './notification-target.ts';
import { addressList, createShape, shape } from './notification-target-form.ts';
import { notificationRequest, notificationResponse } from './notification-sdk-input.ts';
import { targetSpec } from './notification-target-spec.ts';

const read = (
  props: Props,
): Effect.Effect<Record<string, unknown>, ProxmoxOpError, ProxmoxOpContext> => {
  const request = { name: props.name };
  switch (props.type) {
    case 'gotify':
      return cluster.getClusterNotificationEndpointGotify(request).pipe(
        Effect.flatMap(notificationResponse(cluster.GetClusterNotificationEndpointGotifyResponse)),
        Effect.map((row) => ({ ...row })),
      );
    case 'sendmail':
      return cluster.getClusterNotificationEndpointSendmail(request).pipe(
        Effect.flatMap(
          notificationResponse(cluster.GetClusterNotificationEndpointSendmailResponse),
        ),
        Effect.map((row) => ({
          ...row,
          'from-address': row.from_address,
          'mailto-user': row.mailto_user,
        })),
      );
    case 'smtp':
      return cluster.getClusterNotificationEndpointSmtp(request).pipe(
        Effect.flatMap(notificationResponse(cluster.GetClusterNotificationEndpointSmtpResponse)),
        Effect.map((row) => ({
          ...row,
          'from-address': row.from_address,
          'mailto-user': row.mailto_user,
        })),
      );
    case 'webhook':
      return cluster.getClusterNotificationEndpointWebhook(request).pipe(
        Effect.flatMap(notificationResponse(cluster.GetClusterNotificationEndpointWebhookResponse)),
        Effect.map((row) => ({ ...row })),
      );
  }
};

export const readTarget = (props: Props) =>
  runPve(props.target, 'read', false, read(props)).pipe(
    Effect.map((row) => targetSpec.attributes(row, props)),
    Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
  );

/** The legacy forms spell scalar lists explicitly; SDK arrays preserve each logical value. */
const fields = (props: Props, create: boolean) => {
  const form: Record<string, string | string[]> = {
    ...(create ? createShape(props) : shape(props)),
    name: props.name,
  };
  const cleared: string[] = [];
  for (const [key, values] of [
    ['header', props.header === undefined ? undefined : [...props.header]],
    [
      'mailto',
      props.mailto === undefined ? undefined : addressList(props.mailto).split(',').filter(Boolean),
    ],
    [
      'mailto-user',
      props['mailto-user'] === undefined
        ? undefined
        : addressList(props['mailto-user']).split(',').filter(Boolean),
    ],
  ] as const) {
    if (values === undefined) continue;
    if (values.length > 0) form[key] = values;
    else {
      delete form[key];
      if (!create) cleared.push(key);
    }
  }
  // Empty SDK arrays emit no keys; a PUT must explicitly clear a declared empty list.
  if (cleared.length > 0) form.delete = cleared;
  return form;
};

export const createTarget = (props: Props) => {
  const form = fields(props, true);
  const operation =
    props.type === 'sendmail'
      ? notificationRequest(cluster.CreateClusterNotificationEndpointSendmailRequest, form).pipe(
          Effect.flatMap(cluster.createClusterNotificationEndpointSendmail),
        )
      : props.type === 'smtp'
        ? notificationRequest(cluster.CreateClusterNotificationEndpointSmtpRequest, form).pipe(
            Effect.flatMap(cluster.createClusterNotificationEndpointSmtp),
          )
        : props.type === 'gotify'
          ? notificationRequest(cluster.CreateClusterNotificationEndpointGotifyRequest, form).pipe(
              Effect.flatMap(cluster.createClusterNotificationEndpointGotify),
            )
          : notificationRequest(cluster.CreateClusterNotificationEndpointWebhookRequest, form).pipe(
              Effect.flatMap(cluster.createClusterNotificationEndpointWebhook),
            );
  return runPve(props.target, 'provision', true, operation);
};

export const updateTarget = (props: Props) => {
  const form = fields(props, false);
  const operation =
    props.type === 'sendmail'
      ? notificationRequest(cluster.PutClusterNotificationEndpointSendmailRequest, form).pipe(
          Effect.flatMap(cluster.putClusterNotificationEndpointSendmail),
        )
      : props.type === 'smtp'
        ? notificationRequest(cluster.PutClusterNotificationEndpointSmtpRequest, form).pipe(
            Effect.flatMap(cluster.putClusterNotificationEndpointSmtp),
          )
        : props.type === 'gotify'
          ? notificationRequest(cluster.PutClusterNotificationEndpointGotifyRequest, form).pipe(
              Effect.flatMap(cluster.putClusterNotificationEndpointGotify),
            )
          : notificationRequest(cluster.PutClusterNotificationEndpointWebhookRequest, form).pipe(
              Effect.flatMap(cluster.putClusterNotificationEndpointWebhook),
            );
  return runPve(props.target, 'provision', true, operation);
};

export const deleteTarget = (props: Props) => {
  const request = { name: props.name };
  const operation =
    props.type === 'sendmail'
      ? cluster.deleteClusterNotificationEndpointSendmail(request)
      : props.type === 'smtp'
        ? cluster.deleteClusterNotificationEndpointSmtp(request)
        : props.type === 'gotify'
          ? cluster.deleteClusterNotificationEndpointGotify(request)
          : cluster.deleteClusterNotificationEndpointWebhook(request);
  return runPve(props.target, 'provision', true, operation).pipe(
    Effect.catchTag('NotFound', () => Effect.void),
  );
};
