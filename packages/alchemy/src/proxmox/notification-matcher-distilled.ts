/** PVE 9.2.11 matchers through distilled; 404 is measured absence, other failures propagate. */
import * as cluster from '@distilled.cloud/proxmox/cluster';
import * as Effect from 'effect/Effect';
import type { NotificationMatcherProps } from './notification-matcher.ts';
import {
  matcherAttributes,
  matcherCreateForm,
  matcherUpdateForm,
} from './notification-matcher-form.ts';
import { runPve } from './distilled-pve.ts';
import { notificationRequest, notificationResponse } from './notification-sdk-input.ts';

export const readMatcher = (props: NotificationMatcherProps) =>
  runPve(
    props.target,
    'read',
    false,
    cluster.getClusterNotificationMatcher({ name: props.name }),
  ).pipe(
    Effect.flatMap(notificationResponse(cluster.GetClusterNotificationMatcherResponse)),
    Effect.map((live) =>
      matcherAttributes(
        {
          ...live,
          'invert-match': live.invert_match,
          'match-calendar': live.match_calendar,
          'match-field': live.match_field,
          'match-severity': live.match_severity,
        },
        props.name,
      ),
    ),
    Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
  );

export const createMatcher = (props: NotificationMatcherProps) =>
  Effect.gen(function* () {
    const input = yield* notificationRequest(
      cluster.CreateClusterNotificationMatcherRequest,
      matcherCreateForm(props),
    );
    yield* runPve(props.target, 'provision', true, cluster.createClusterNotificationMatcher(input));
  });

export const updateMatcher = (props: NotificationMatcherProps) =>
  Effect.gen(function* () {
    const input = yield* notificationRequest(cluster.PutClusterNotificationMatcherRequest, {
      ...matcherUpdateForm(props),
      name: props.name,
    });
    yield* runPve(props.target, 'provision', true, cluster.putClusterNotificationMatcher(input));
  });

export const deleteMatcher = (props: NotificationMatcherProps) =>
  runPve(
    props.target,
    'provision',
    true,
    cluster.deleteClusterNotificationMatcher({ name: props.name }),
  ).pipe(Effect.catchTag('NotFound', () => Effect.void));
