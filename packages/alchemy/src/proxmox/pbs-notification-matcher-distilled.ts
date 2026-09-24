/** PBS 4.2.6-1 matcher operations through SDK 0.3.0; failed reads never become absence. */
import * as config from '@distilled.cloud/proxmox-backup/config';
import * as Effect from 'effect/Effect';
import { notificationInput } from './pbs-notification-input.ts';
import { runPbs } from './distilled-pbs.ts';
import {
  type MatcherCreateForm,
  type MatcherUpdateForm,
  matcherAttributes,
} from './notification-matcher-form.ts';
import type { PbsNotificationMatcherProps as Props } from './pbs-notification-matcher.ts';

export const readMatcher = (props: Props) =>
  runPbs(props.target, 'read', config.getConfigNotificationMatcher({ name: props.name })).pipe(
    Effect.map((row) =>
      matcherAttributes(
        {
          ...row,
          'invert-match': row.invert_match,
          'match-calendar': row.match_calendar,
          'match-field': row.match_field,
          'match-severity': row.match_severity,
        },
        props.name,
      ),
    ),
    Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
  );

/** Validate with the SDK's request schema after spelling the shared PVE/PBS form's keys. */
const requestFields = (props: Props, form: MatcherCreateForm | MatcherUpdateForm) => ({
  ...form,
  invert_match: form['invert-match'],
  match_calendar: form['match-calendar'],
  match_field: form['match-field'],
  match_severity: form['match-severity'],
  name: props.name,
});

export const createMatcher = (props: Props, form: MatcherCreateForm) =>
  runPbs(
    props.target,
    'provision',
    notificationInput(
      config.CreateConfigNotificationMatcherRequest,
      requestFields(props, form),
    ).pipe(Effect.flatMap(config.createConfigNotificationMatcher)),
  );

export const updateMatcher = (props: Props, form: MatcherUpdateForm) =>
  runPbs(
    props.target,
    'provision',
    notificationInput(config.PutConfigNotificationMatcherRequest, requestFields(props, form)).pipe(
      Effect.flatMap(config.putConfigNotificationMatcher),
    ),
  );

/** PBS reverts built-ins on deletion; it reports NotFound only for an absent user-created row. */
export const deleteMatcher = (props: Props) =>
  runPbs(
    props.target,
    'provision',
    config.deleteConfigNotificationMatcher({ name: props.name }),
  ).pipe(Effect.catchTag('NotFound', () => Effect.void));
