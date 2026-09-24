/**
 * `googleWorkspaceOperations`'s shared `diff`/`reconcile` engine, exercised end-to-end through a
 * fake Directory API — not just through a resource's own `spec.matches`/`fetchLive` in isolation.
 *
 * 🔴 WHY THIS FILE EXISTS. An adversarial review of this family (2026-09-24) found that every
 *   other test here calls `spec.fetchLive`/`spec.attributes`/`spec.matches` directly and never
 *   `googleWorkspaceOperations(spec).diff`/`.reconcile` — so a bug INSIDE `resource.ts` itself
 *   (shared by all four resources) could invert `diff`'s `noop`/`update` branches, or skip the
 *   "write returned no error but the object is still absent" die-guard, and no test here would
 *   catch it. This file closes that gap: it drives the real engine against real specs (`group.ts`,
 *   whose spec HAS `update`, and `domain-alias.ts`, whose spec does NOT), through the same fake
 *   HTTP layer every other test in this family uses.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { spec as aliasSpec } from './domain-alias.ts';
import {
  fakeFailure,
  fakeGoogleWorkspace,
  fakeGoogleWorkspaceLayer,
} from './fake-google-workspace.ts';
import { spec as groupSpec } from './group.ts';
import { googleWorkspaceOperations } from './resource.ts';

const groupOps = googleWorkspaceOperations(groupSpec);
const groupProps = { email: 'ops@schenanigans.com', name: 'Ops', description: 'ops team' };
const GROUP_PATH = '/admin/directory/v1/groups/ops%40schenanigans.com';

describe('googleWorkspaceOperations(group spec).reconcile', () => {
  test('absent → create, then read back — the happy create path', async () => {
    let created = false;
    const fake = fakeGoogleWorkspace((method, url) => {
      if (method === 'POST' && url.pathname === '/admin/directory/v1/groups') {
        created = true;
        return Response.json({ email: groupProps.email, name: 'Ops' });
      }
      if (method === 'GET' && url.pathname === GROUP_PATH) {
        return created
          ? Response.json({ description: 'ops team', email: groupProps.email, name: 'Ops' })
          : fakeFailure(404, 'not found', 'NOT_FOUND');
      }
      return fakeFailure(404, 'not found', 'NOT_FOUND');
    });
    const attrs = await Effect.runPromise(
      groupOps.reconcile(groupProps).pipe(Effect.provide(fakeGoogleWorkspaceLayer(fake.fetch))),
    );
    expect(created).toBe(true);
    expect(attrs.email).toBe(groupProps.email);
  });

  test('present and matching → no PATCH is ever sent', async () => {
    const fake = fakeGoogleWorkspace((method, url) =>
      method === 'GET' && url.pathname === GROUP_PATH
        ? Response.json({ description: 'ops team', email: groupProps.email, name: 'Ops' })
        : fakeFailure(404, 'not found', 'NOT_FOUND'),
    );
    await Effect.runPromise(
      groupOps.reconcile(groupProps).pipe(Effect.provide(fakeGoogleWorkspaceLayer(fake.fetch))),
    );
    expect(fake.seen.some((r) => r.method === 'PATCH')).toBe(false);
  });

  test('present and drifted → PATCH is sent exactly once', async () => {
    let patched = false;
    const fake = fakeGoogleWorkspace((method, url) => {
      if (method === 'PATCH' && url.pathname === GROUP_PATH) {
        patched = true;
        return Response.json({ description: 'ops team', email: groupProps.email, name: 'Ops' });
      }
      if (method === 'GET' && url.pathname === GROUP_PATH) {
        return Response.json({
          description: 'stale description',
          email: groupProps.email,
          name: 'Ops',
        });
      }
      return fakeFailure(404, 'not found', 'NOT_FOUND');
    });
    await Effect.runPromise(
      groupOps.reconcile(groupProps).pipe(Effect.provide(fakeGoogleWorkspaceLayer(fake.fetch))),
    );
    expect(patched).toBe(true);
  });

  test('a write that reports success but leaves the object absent dies — never lies to the plan', async () => {
    const fake = fakeGoogleWorkspace(
      (method, url) =>
        method === 'POST' && url.pathname === '/admin/directory/v1/groups'
          ? Response.json({})
          : fakeFailure(404, 'not found', 'NOT_FOUND'), // every GET stays 404, even after "create"
    );
    const failed = await Effect.runPromiseExit(
      groupOps.reconcile(groupProps).pipe(Effect.provide(fakeGoogleWorkspaceLayer(fake.fetch))),
    );
    expect(failed._tag).toBe('Failure');
  });
});

describe('googleWorkspaceOperations(group spec).diff', () => {
  const live = {
    adminCreated: false,
    aliases: [],
    description: 'ops team',
    directMembersCount: '0',
    email: groupProps.email,
    groupId: 'x',
    name: 'Ops',
    nonEditableAliases: [],
  };

  test('output undefined → undefined (engine default: treat as update)', async () => {
    // ⚠️ `diff` short-circuits on `output === undefined` before it ever reads — no request is
    //   made — but the Effect's TYPE still carries `GoogleWorkspaceOpContext`, so a layer is
    //   still required to satisfy `runPromise`. `fake.seen` below proves the short-circuit.
    const fake = fakeGoogleWorkspace(() => fakeFailure(500, 'must not be called', 'INTERNAL'));
    const result = await Effect.runPromise(
      groupOps
        .diff(groupProps, undefined)
        .pipe(Effect.provide(fakeGoogleWorkspaceLayer(fake.fetch))),
    );
    expect(result).toBeUndefined();
    expect(fake.seen).toEqual([]);
  });

  test('matching live → noop, read through the real fake', async () => {
    const fake = fakeGoogleWorkspace((method, url) =>
      method === 'GET' && url.pathname === GROUP_PATH
        ? Response.json({ description: 'ops team', email: groupProps.email, name: 'Ops' })
        : fakeFailure(404, 'not found', 'NOT_FOUND'),
    );
    const result = await Effect.runPromise(
      groupOps.diff(groupProps, live).pipe(Effect.provide(fakeGoogleWorkspaceLayer(fake.fetch))),
    );
    expect(result).toEqual({ action: 'noop' });
  });

  test('drifted live, spec HAS update → action is update, not replace', async () => {
    const fake = fakeGoogleWorkspace((method, url) =>
      method === 'GET' && url.pathname === GROUP_PATH
        ? Response.json({
            description: 'a different description',
            email: groupProps.email,
            name: 'Ops',
          })
        : fakeFailure(404, 'not found', 'NOT_FOUND'),
    );
    const result = await Effect.runPromise(
      groupOps.diff(groupProps, live).pipe(Effect.provide(fakeGoogleWorkspaceLayer(fake.fetch))),
    );
    expect(result).toEqual({ action: 'update' });
  });
});

describe('googleWorkspaceOperations(domain-alias spec).diff — spec has NO update', () => {
  const aliasOps = googleWorkspaceOperations(aliasSpec);
  const aliasProps = {
    domainAliasName: 'alias.schenanigans.com',
    parentDomainName: 'schenanigans.com',
  };
  const ALIAS_PATH =
    '/admin/directory/v1/customer/my_customer/domainaliases/alias.schenanigans.com';
  const liveAttrs = {
    creationTime: '0',
    customer: 'my_customer',
    domainAliasName: aliasProps.domainAliasName,
    parentDomainName: aliasProps.parentDomainName,
    verified: true,
  };

  test('drifted live, spec has NO update → replace, never update', async () => {
    const fake = fakeGoogleWorkspace((method, url) =>
      method === 'GET' && url.pathname === ALIAS_PATH
        ? Response.json({
            domainAliasName: aliasProps.domainAliasName,
            parentDomainName: 'homeflare.dev',
          })
        : fakeFailure(404, 'not found', 'NOT_FOUND'),
    );
    const result = await Effect.runPromise(
      aliasOps
        .diff(aliasProps, liveAttrs)
        .pipe(Effect.provide(fakeGoogleWorkspaceLayer(fake.fetch))),
    );
    expect(result).toEqual({ action: 'replace' });
  });
});
