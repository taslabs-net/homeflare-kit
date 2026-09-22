/**
 * A literal credential in a plain `Pbs.NotificationTarget` prop is refused — and refused BEFORE
 * Alchemy writes the props to the state store, which is the whole point.
 *
 * ★ THE END-TO-END CASES RUN ALCHEMY'S OWN PLAN AND APPLY (verify/fake-engine.ts) and dump the
 *   store, because the failure being pinned is not "a refusal exists" but "the token never
 *   reached the row": before the fix a refused create had already committed its props.
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import type { PbsTarget } from './credentials.ts';
import {
  isCredentialName,
  literalCredentialHeaders,
  literalCredentialsInUrl,
} from './credential-literals.ts';
import { fakeNotify } from './fake-pbs-notify.ts';
import { withoutBao } from './fake-pve.ts';
import {
  PbsNotificationTarget,
  type PbsNotificationTargetProps,
  PbsNotificationTargetProvider,
} from './pbs-notification-target.ts';
import { refusals } from './pbs-notification-target-form.ts';

const PBS: PbsTarget = { api: 'https://pbs.test:8007/api2/json', mount: 'pbs-test', scheme: 'pbs' };
const LITERAL = 'lit-7a1c-not-real';
const AM = 'https://alertmanager.example.com/api/v2/alerts';

const hook = (over: Partial<PbsNotificationTargetProps> = {}): PbsNotificationTargetProps => ({
  method: 'post',
  name: 'alertmanager',
  target: PBS,
  type: 'webhook',
  url: AM,
  ...over,
});

describe('which names are credentials', () => {
  test('authorization, cookie and credential words — whole names or dash/underscore words', () => {
    for (const name of ['Authorization', 'proxy-authorization', 'Cookie', 'X-Api-Key', 'api_key']) {
      expect(isCredentialName(name)).toBe(true);
    }
    for (const name of ['X-Auth-Token', 'Private-Token', 'X-Gotify-Key', 'token', 'sig', 'code']) {
      expect(isCredentialName(name)).toBe(true);
    }
    for (const name of ['Content-Type', 'X-Scope-OrgID', 'Author', 'Keyword', 'Passthrough']) {
      expect(isCredentialName(name)).toBe(false);
    }
  });
});

describe('literal credentials are found by where they sit', () => {
  test('headers: a literal is refused; a secrets template, `{ fromEnv }` and `""` are not', () => {
    expect(
      literalCredentialHeaders({
        'Content-Type': 'application/json',
        Cookie: `session=${LITERAL}`,
        'X-Api-Key': { fromEnv: 'HOOK_KEY' },
        Authorization: `Bearer ${LITERAL}`,
        'X-Auth-Token': '{{secrets.token}}',
        'X-Empty-Token': '',
      }),
    ).toEqual(['Authorization', 'Cookie']);
    expect(literalCredentialHeaders({ Authorization: 'Bearer {{ secrets.token }}' })).toEqual([]);
    expect(literalCredentialHeaders(undefined)).toEqual([]);
  });

  test('a URL: a userinfo password and credential-named query parameters, by name', () => {
    expect(literalCredentialsInUrl(`https://pbs:${LITERAL}@am.example.com/x`)).toEqual([
      'userinfo',
    ]);
    expect(literalCredentialsInUrl(`${AM}?token=${LITERAL}&team=ops&api_key=${LITERAL}`)).toEqual([
      '?token',
      '?api_key',
    ]);
    expect(literalCredentialsInUrl(`${AM}?code=${LITERAL}#token=${LITERAL}`)).toEqual([
      '?code',
      '?token',
    ]);
    expect(literalCredentialsInUrl(`${AM}#team=ops&sig=${LITERAL}`)).toEqual(['?sig']);
  });

  test('a URL that references its secrets, or has no password, is clean', () => {
    for (const url of [
      AM,
      `${AM}?team=ops`,
      `${AM}?token={{ url-encode secrets.token }}`,
      'https://pbs:{{ secrets.pw }}@am.example.com/',
      'https://pbs@am.example.com/',
      `${AM}?token=`,
      undefined,
    ]) {
      expect(literalCredentialsInUrl(url)).toEqual([]);
    }
  });

  test('refusals name the header or the URL part — never the value', () => {
    const reasons = refusals(
      hook({ header: { Authorization: `Bearer ${LITERAL}` }, url: `${AM}?token=${LITERAL}` }),
    );
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toStartWith("header 'Authorization' holds a literal credential");
    expect(reasons[1]).toStartWith("'url' ?token holds a literal credential");
    expect(reasons.join(' ')).not.toContain(LITERAL);
  });
});

describe('through Alchemy: refused at plan, before anything is stored or sent', () => {
  const run = async (props: PbsNotificationTargetProps) => {
    const fake = fakeNotify();
    let failure = '';
    let stored = '';
    await withoutBao(async () => {
      const engine = engineOver(
        PbsNotificationTargetProvider().pipe(Layer.provideMerge(fake.layer)),
      );
      await engine.deploy(PbsNotificationTarget('alertmanager', props)).catch((error: unknown) => {
        failure = String(error);
      });
      stored = engine.stored();
    });
    return { failure, stored, writes: fake.writes() };
  };

  test('a literal Authorization header on a NEW target never reaches the store', async () => {
    const { failure, stored, writes } = await run(
      hook({ header: { Authorization: `Bearer ${LITERAL}` } }),
    );
    expect(failure).toContain("header 'Authorization' holds a literal credential");
    expect(stored).not.toContain(LITERAL);
    expect(writes).toEqual([]);
  });

  test('a literal query token on a NEW target never reaches the store', async () => {
    const { failure, stored, writes } = await run(hook({ url: `${AM}?token=${LITERAL}` }));
    expect(failure).toContain("'url' ?token holds a literal credential");
    expect(stored).not.toContain(LITERAL);
    expect(writes).toEqual([]);
  });

  test('any other refusal on a new target also fails before the row is written', async () => {
    const { failure, stored } = await run(hook({ comment: LITERAL, mailto: ['x@example.com'] }));
    expect(failure).toContain("'mailto' belongs to sendmail/smtp targets, not webhook");
    expect(stored).not.toContain(LITERAL);
  });
});
