/**
 * `Pbs.NotificationTarget` — refusals, the wire forms against the generated PBS schema, and the
 * rule that no header or secret VALUE reaches an attribute.
 *
 * ⚠️ THE DRIFT CHECK IS A TYPED KEY LIST PER FAMILY. `targetForm` builds one flat body for three
 *   families, so it cannot be typed as any one of them; instead each list below `satisfies` the
 *   generated parameter keys (and each `delete` value the generated enum), and every form this file
 *   builds is asserted to stay inside its list. A renamed parameter fails `tsc` on the list.
 */
import { describe, expect, test } from 'bun:test';
import type {
  ConfigNotificationsEndpointsSendmailNamePutParams,
  ConfigNotificationsEndpointsSmtpPostParams,
  ConfigNotificationsEndpointsWebhookNamePutParams,
  ConfigNotificationsEndpointsWebhookPostParams,
} from './generated/pbs.ts';
import type { PbsTarget } from './credentials.ts';
import type { PbsNotificationTargetProps } from './pbs-notification-target.ts';
import { refusals, resolveGroups, targetForm } from './pbs-notification-target-form.ts';
import { keyAndValue, targetAttributes, unbase64 } from './pbs-notification-target-wire.ts';

const PBS: PbsTarget = { api: 'https://pbs.test:8007/api2/json', mount: 'pbs-test', scheme: 'pbs' };
const TOKEN = 'tok-5f0c1d2e-not-real';
const ENV = { HOOK_TOKEN: TOKEN, SMTP_PASSWORD: 'pw-not-real' };

const WEBHOOK_POST = [
  'body',
  'comment',
  'disable',
  'header',
  'method',
  'name',
  'secret',
  'url',
] as const satisfies readonly (keyof ConfigNotificationsEndpointsWebhookPostParams)[];
const WEBHOOK_PUT = [
  'body',
  'comment',
  'delete',
  'disable',
  'header',
  'method',
  'secret',
  'url',
] as const satisfies readonly (keyof ConfigNotificationsEndpointsWebhookNamePutParams)[];
const WEBHOOK_DELETE = [
  'body',
  'comment',
  'header',
  'secret',
] as const satisfies readonly NonNullable<
  ConfigNotificationsEndpointsWebhookNamePutParams['delete']
>[number][];
const SMTP_POST = [
  'author',
  'comment',
  'disable',
  'from-address',
  'mailto',
  'mailto-user',
  'mode',
  'name',
  'password',
  'port',
  'server',
  'username',
] as const satisfies readonly (keyof ConfigNotificationsEndpointsSmtpPostParams)[];
const SENDMAIL_DELETE = [
  'author',
  'comment',
  'from-address',
  'mailto',
  'mailto-user',
] as const satisfies readonly NonNullable<
  ConfigNotificationsEndpointsSendmailNamePutParams['delete']
>[number][];

const webhook = (over: Partial<PbsNotificationTargetProps> = {}): PbsNotificationTargetProps => ({
  body: '{"text": {{ json title }}}',
  header: { Authorization: 'Bearer {{ secrets.token }}', 'Content-Type': 'application/json' },
  method: 'post',
  name: 'alertmanager',
  secret: { token: { fromEnv: 'HOOK_TOKEN' } },
  target: PBS,
  type: 'webhook',
  url: 'https://alertmanager.example.com/api/v2/alerts',
  ...over,
});

const all = { header: true, sealed: true } as const;
const keysOf = (form: object) => Object.keys(form).sort();

describe('refusals, at plan, by field name', () => {
  test('a field outside its family, a missing required field, a name that breaks the wire', () => {
    expect(refusals(webhook())).toEqual([]);
    expect(refusals({ name: 'm', target: PBS, type: 'sendmail', url: 'https://x.test' })).toEqual([
      "'url' belongs to webhook targets, not sendmail",
    ]);
    expect(refusals(webhook({ url: undefined as never }))).toContain("webhook needs 'url'");
    expect(refusals({ name: 's', server: 'mx.test', target: PBS, type: 'smtp' })).toEqual([
      "smtp needs 'from-address'",
    ]);
    expect(refusals(webhook({ header: { 'X-A,b': 'v' } }))).toEqual([
      "'X-A,b' cannot be a header or secret name",
    ]);
  });
});

describe('webhook forms', () => {
  const groups = resolveGroups(webhook(), ENV);

  test('a create carries base64 body, header and secret items, and stays inside the schema', () => {
    const form = targetForm(webhook(), groups, all, 'create');
    expect(keysOf(form).every((key) => (WEBHOOK_POST as readonly string[]).includes(key))).toBe(
      true,
    );
    expect(unbase64(String(form['body']))).toBe('{"text": {{ json title }}}');
    const secret = (form['secret'] as readonly string[]).map(keyAndValue);
    expect(secret).toEqual([{ name: 'token', value: Buffer.from(TOKEN).toString('base64') }]);
    const headers = (form['header'] as readonly string[]).map(keyAndValue);
    expect(headers.map((h) => [h.name, unbase64(h.value ?? '')])).toEqual([
      ['Authorization', 'Bearer {{ secrets.token }}'],
      ['Content-Type', 'application/json'],
    ]);
    expect(form['disable']).toBe('0');
  });

  test('an update carries only the groups it was told to — omitted means "keep"', () => {
    const form = targetForm(
      webhook({ comment: 'x' }),
      groups,
      { header: false, sealed: false },
      'update',
    );
    expect(keysOf(form)).toEqual(['body', 'comment', 'disable', 'method', 'url']);
    expect(keysOf(form).every((key) => (WEBHOOK_PUT as readonly string[]).includes(key))).toBe(
      true,
    );
  });

  test('clearing is a `delete` inside the generated enum', () => {
    const cleared = webhook({ body: '', comment: '', header: {}, secret: {} });
    const form = targetForm(cleared, resolveGroups(cleared, ENV), all, 'update');
    expect(form['delete']).toEqual(['body', 'comment', 'header', 'secret']);
    expect(
      (form['delete'] as readonly string[]).every((d) =>
        (WEBHOOK_DELETE as readonly string[]).includes(d),
      ),
    ).toBe(true);
  });
});

describe('mail forms', () => {
  test('smtp: recipients sorted, password sent only when its group is carried', () => {
    const smtp: PbsNotificationTargetProps = {
      'from-address': 'pbs@example.com',
      mailto: ['b@example.com', 'a@example.com'],
      name: 'relay',
      password: { fromEnv: 'SMTP_PASSWORD' },
      server: 'mx.example.com',
      target: PBS,
      type: 'smtp',
      username: 'pbs',
    };
    const groups = resolveGroups(smtp, ENV);
    const create = targetForm(smtp, groups, all, 'create');
    expect(create['mailto']).toEqual(['a@example.com', 'b@example.com']);
    expect(create['password']).toBe('pw-not-real');
    expect(keysOf(create).every((key) => (SMTP_POST as readonly string[]).includes(key))).toBe(
      true,
    );
    expect(
      targetForm(smtp, groups, { header: false, sealed: false }, 'update')['password'],
    ).toBeUndefined();
  });

  test('sendmail: an emptied list and an empty from-address clear, inside the enum', () => {
    const sendmail: PbsNotificationTargetProps = {
      'from-address': '',
      mailto: [],
      name: 'mail-to-root',
      target: PBS,
      type: 'sendmail',
    };
    const form = targetForm(sendmail, resolveGroups(sendmail, ENV), all, 'update');
    expect(form['delete']).toEqual(['from-address', 'mailto']);
    expect(
      (form['delete'] as readonly string[]).every((d) =>
        (SENDMAIL_DELETE as readonly string[]).includes(d),
      ),
    ).toBe(true);
  });
});

describe('attributes', () => {
  const live = {
    body: Buffer.from('{}').toString('base64'),
    header: [`name=Authorization,value=${Buffer.from(`Bearer ${TOKEN}`).toString('base64')}`],
    method: 'post',
    name: 'alertmanager',
    origin: 'user-created',
    secret: ['name=token'],
    url: 'https://alertmanager.example.com/api/v2/alerts',
  };

  test('keep header and secret NAMES and a digest — never a value, raw or base64', () => {
    const attributes = targetAttributes(live, webhook());
    expect(attributes.header).toBe('Authorization');
    expect(attributes.secret).toBe('token');
    expect(attributes.headerDigest).toStartWith('scrypt:');
    const text = JSON.stringify(attributes);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(Buffer.from(`Bearer ${TOKEN}`).toString('base64'));
    expect(attributes.body).toBe('{}');
  });

  test('the header digest is stable across reads and moves with the value', () => {
    const again = targetAttributes(live, webhook());
    expect(again.headerDigest).toBe(targetAttributes(live, webhook()).headerDigest);
    const other = {
      ...live,
      header: [`name=Authorization,value=${Buffer.from('Bearer other').toString('base64')}`],
    };
    expect(targetAttributes(other, webhook()).headerDigest).not.toBe(again.headerDigest);
  });
});
