/**
 * `GoogleWorkspace.DomainAlias`'s `spec` against a fake Directory API — no `update` operation
 * exists (domain-alias.ts's own note), so this only proves `fetchLive`/`attributes`/`matches`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import {
  fakeFailure,
  fakeGoogleWorkspace,
  fakeGoogleWorkspaceLayer,
} from './fake-google-workspace.ts';
import { spec } from './domain-alias.ts';

const ALIAS_PATH = '/admin/directory/v1/customer/my_customer/domainaliases/alias.schenanigans.com';
const props = { domainAliasName: 'alias.schenanigans.com', parentDomainName: 'schenanigans.com' };

const readThrough = (fetchFn: typeof globalThis.fetch) =>
  Effect.runPromise(
    spec.fetchLive(props).pipe(
      Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))),
      Effect.provide(fakeGoogleWorkspaceLayer(fetchFn)),
    ),
  );

describe('GoogleWorkspace.DomainAlias spec.fetchLive + spec.attributes', () => {
  test('a live alias decodes with the default my_customer scope', async () => {
    const fake = fakeGoogleWorkspace((method, url) =>
      method === 'GET' && url.pathname === ALIAS_PATH
        ? Response.json({
            creationTime: '1700000000000',
            domainAliasName: 'alias.schenanigans.com',
            parentDomainName: 'schenanigans.com',
            verified: true,
          })
        : fakeFailure(404, 'not found', 'NOT_FOUND'),
    );
    expect(await readThrough(fake.fetch)).toEqual({
      creationTime: '1700000000000',
      customer: 'my_customer',
      domainAliasName: 'alias.schenanigans.com',
      parentDomainName: 'schenanigans.com',
      verified: true,
    });
  });

  test('a 404 folds to undefined', async () => {
    const fake = fakeGoogleWorkspace(() => fakeFailure(404, 'not found', 'NOT_FOUND'));
    expect(await readThrough(fake.fetch)).toBeUndefined();
  });
});

describe('GoogleWorkspace.DomainAlias spec.matches and spec.update', () => {
  const live = {
    creationTime: '1700000000000',
    customer: 'my_customer',
    domainAliasName: 'alias.schenanigans.com',
    parentDomainName: 'schenanigans.com',
    verified: true,
  };

  test('the same parentDomainName is no drift', () => {
    expect(spec.matches(live, props)).toBe(true);
  });

  test('a different parentDomainName is drift — and since there is no update, diff replaces', () => {
    expect(spec.matches(live, { ...props, parentDomainName: 'homeflare.dev' })).toBe(false);
    expect(spec.update).toBeUndefined();
  });
});
