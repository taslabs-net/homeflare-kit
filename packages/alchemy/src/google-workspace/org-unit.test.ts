/**
 * `GoogleWorkspace.OrgUnit`'s `spec` against a fake Directory API — proves the leading-slash
 * asymmetry `values.ts`'s `stripLeadingSlash`/`withLeadingSlash` exist for (org-unit.ts's note).
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import {
  fakeFailure,
  fakeGoogleWorkspace,
  fakeGoogleWorkspaceLayer,
} from './fake-google-workspace.ts';
import { spec } from './org-unit.ts';

const UNIT_PATH = '/admin/directory/v1/customer/my_customer/orgunits/Contractors/2026';
const props = {
  orgUnitPath: '/Contractors/2026',
  parentOrgUnitPath: '/Contractors',
  description: '2026 cohort',
};

const readThrough = (fetchFn: typeof globalThis.fetch) =>
  Effect.runPromise(
    spec.fetchLive(props).pipe(
      Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))),
      Effect.provide(fakeGoogleWorkspaceLayer(fetchFn)),
    ),
  );

describe('GoogleWorkspace.OrgUnit spec.fetchLive + spec.attributes', () => {
  test('the path is sent without its leading slash, and read back with one', async () => {
    const fake = fakeGoogleWorkspace((method, url) =>
      method === 'GET' && url.pathname === UNIT_PATH
        ? Response.json({
            description: '2026 cohort',
            name: '2026',
            orgUnitId: 'id:0123',
            orgUnitPath: '/Contractors/2026',
            parentOrgUnitPath: '/Contractors',
          })
        : fakeFailure(404, 'not found', 'NOT_FOUND'),
    );
    expect(await readThrough(fake.fetch)).toEqual({
      customerId: 'my_customer',
      description: '2026 cohort',
      name: '2026',
      orgUnitId: 'id:0123',
      orgUnitPath: '/Contractors/2026',
      parentOrgUnitPath: '/Contractors',
    });
    expect(fake.seen).toEqual([{ method: 'GET', path: UNIT_PATH }]);
  });

  test('a 404 folds to undefined', async () => {
    const fake = fakeGoogleWorkspace(() => fakeFailure(404, 'not found', 'NOT_FOUND'));
    expect(await readThrough(fake.fetch)).toBeUndefined();
  });
});

describe('GoogleWorkspace.OrgUnit spec.matches', () => {
  const live = {
    customerId: 'my_customer',
    description: '2026 cohort',
    name: '2026',
    orgUnitId: 'id:0123',
    orgUnitPath: '/Contractors/2026',
    parentOrgUnitPath: '/Contractors',
  };

  test('matching name, parent and description is no drift', () => {
    expect(spec.matches(live, props)).toBe(true);
  });

  test('a moved parent is drift', () => {
    expect(spec.matches(live, { ...props, parentOrgUnitPath: '/Employees' })).toBe(false);
  });

  test('an undeclared parentOrgUnitPath converges to the root, deterministically', () => {
    const { parentOrgUnitPath: _p, ...rootProps } = props;
    expect(spec.matches({ ...live, parentOrgUnitPath: '/' }, rootProps)).toBe(true);
  });
});
