/**
 * A fake of LiteLLM's `/policies` routes for tests — TEST ONLY. Skeleton and the rules every fake
 * follows: fake-registry-base.ts. (The attachment routes are `fake-policy-attachment-litellm.ts`.)
 *
 * ★ MEASURED FROM THE LIVE 1.103.0 CONTAINER'S SOURCE (2026-09-30, `policy_endpoints.py` and
 *   `policy_registry.py`, read, not called): a create makes version 1 AS PRODUCTION, and a second create
 *   of the name is a 400; the version list is a `find_many` by name (an unknown name is an empty list,
 *   200); a new version is a DRAFT cloned from production (404 when there is no production) with the
 *   next version number; `PUT /policies/{id}` edits a DRAFT only (400 otherwise, 404 missing) and writes
 *   only fields that are not null; `draft → published` and `published → production` (which demotes the
 *   old production to `published`) are the only promotions, and `draft → production` is a 400;
 *   `DELETE …/all-versions` answers 200 whether or not anything existed; the list merges in
 *   config.yaml policies (`definition_location: "config"`).
 * ⚠️ NOT MODELLED: `pipeline`, the in-memory registry, `is_latest` bookkeeping beyond what a test reads.
 */
import { FAKE_KEY, type FakeRecord, json, recordingFetch } from './fake-registry-base.ts';
import type { Row } from './registry-support.ts';

export interface FakePolicyLitellm extends FakeRecord {
  /** Every stored version, exactly as the proxy holds it. */
  readonly versions: () => readonly Row[];
}

export interface FakePolicyOptions {
  readonly masterKey?: string;
  readonly seed?: readonly Row[];
  /** Policies defined in config.yaml: they appear in `/policies/list` with `definition_location: config`. */
  readonly configPolicies?: readonly string[];
  /** A `PUT /policies/{id}` drops an empty list instead of writing it. */
  readonly editIgnoresEmpty?: boolean;
}

export const policyRow = (fields: Row): Row => ({
  condition: null,
  description: null,
  guardrails_add: [],
  guardrails_remove: [],
  inherit: null,
  is_latest: true,
  pipeline: null,
  version_number: 1,
  version_status: 'production',
  ...fields,
});

export const startFakePolicyLitellm = (options: FakePolicyOptions = {}): FakePolicyLitellm => {
  let rows: Row[] = (options.seed ?? []).map((row) => ({ ...row }));
  let issued = 0;
  const nextId = () => `FAKE-policy-${String((issued += 1)).padStart(4, '0')}`;

  const record = recordingFetch(options.masterKey ?? FAKE_KEY, ({ body, request, url }) => {
    const versionsOf = /^\/policies\/name\/([^/]+)\/versions$/.exec(url.pathname);
    const allOf = /^\/policies\/name\/([^/]+)\/all-versions$/.exec(url.pathname);
    const statusOf = /^\/policies\/([^/]+)\/status$/.exec(url.pathname);
    const byId = /^\/policies\/([^/]+)$/.exec(url.pathname);

    if (versionsOf !== null && request.method === 'GET') {
      const name = decodeURIComponent(versionsOf[1] ?? '');
      const found = rows.filter((row) => row['policy_name'] === name);
      return json(200, { policy_name: name, total_count: found.length, versions: found });
    }
    if (url.pathname === '/policies/list' && request.method === 'GET') {
      const only = url.searchParams.get('version_status');
      const db = rows.filter((row) => only === null || row['version_status'] === only);
      const held = new Set(
        rows
          .filter((row) => row['version_status'] === 'production')
          .map((row) => row['policy_name']),
      );
      const config = (options.configPolicies ?? [])
        .filter((name) => !held.has(name))
        .map((name) =>
          policyRow({ definition_location: 'config', policy_id: name, policy_name: name }),
        );
      return json(200, { policies: [...db, ...config], total_count: db.length + config.length });
    }
    if (url.pathname === '/policies' && request.method === 'POST') {
      if (
        rows.some(
          (row) => row['policy_name'] === body['policy_name'] && row['version_number'] === 1,
        )
      ) {
        return json(400, {
          detail: `Policy with name '${String(body['policy_name'])}' already exists`,
        });
      }
      const created = policyRow({
        condition: body['condition'] ?? null,
        description: body['description'] ?? null,
        guardrails_add: body['guardrails_add'] ?? [],
        guardrails_remove: body['guardrails_remove'] ?? [],
        inherit: body['inherit'] ?? null,
        policy_id: nextId(),
        policy_name: body['policy_name'],
      });
      rows = [...rows, created];
      return json(200, created);
    }
    if (versionsOf !== null && request.method === 'POST') {
      const name = decodeURIComponent(versionsOf[1] ?? '');
      const source = rows.find(
        (row) => row['policy_name'] === name && row['version_status'] === 'production',
      );
      if (source === undefined) {
        return json(404, { detail: `No production version found for policy '${name}'` });
      }
      const latest = Math.max(
        ...rows
          .filter((row) => row['policy_name'] === name)
          .map((row) => Number(row['version_number'])),
      );
      const draft = {
        ...source,
        is_latest: true,
        parent_version_id: source['policy_id'],
        policy_id: nextId(),
        version_number: latest + 1,
        version_status: 'draft',
      };
      rows = [
        ...rows.map((row) => (row['policy_name'] === name ? { ...row, is_latest: false } : row)),
        draft,
      ];
      return json(200, draft);
    }
    if (statusOf !== null && request.method === 'PUT') {
      const id = decodeURIComponent(statusOf[1] ?? '');
      const row = rows.find((each) => each['policy_id'] === id);
      if (row === undefined) return json(404, { detail: `Policy with ID ${id} not found` });
      const target = body['version_status'];
      if (target === 'published' && row['version_status'] !== 'draft') {
        return json(400, { detail: 'Only draft versions can be published.' });
      }
      if (target === 'production' && row['version_status'] !== 'published') {
        return json(400, {
          detail: 'Cannot promote draft directly to production. Publish the version first.',
        });
      }
      if (target !== 'published' && target !== 'production')
        return json(400, { detail: 'Invalid status' });
      rows = rows.map((each) => {
        if (each['policy_id'] === id) return { ...each, version_status: target };
        return target === 'production' &&
          each['policy_name'] === row['policy_name'] &&
          each['version_status'] === 'production'
          ? { ...each, version_status: 'published' }
          : each;
      });
      return json(
        200,
        rows.find((each) => each['policy_id'] === id),
      );
    }
    if (byId !== null && request.method === 'PUT') {
      const id = decodeURIComponent(byId[1] ?? '');
      const row = rows.find((each) => each['policy_id'] === id);
      if (row === undefined) return json(404, { detail: `Policy with ID ${id} not found` });
      if (row['version_status'] !== 'draft') {
        return json(400, {
          detail:
            'Only draft versions can be updated. Publish or create a new version to change published/production.',
        });
      }
      const patch = Object.fromEntries(
        Object.entries(body).filter(
          ([, value]) =>
            value !== null &&
            !(options.editIgnoresEmpty === true && Array.isArray(value) && value.length === 0),
        ),
      );
      rows = rows.map((each) => (each['policy_id'] === id ? { ...each, ...patch } : each));
      return json(
        200,
        rows.find((each) => each['policy_id'] === id),
      );
    }
    if (allOf !== null && request.method === 'DELETE') {
      const name = decodeURIComponent(allOf[1] ?? '');
      rows = rows.filter((row) => row['policy_name'] !== name);
      return json(200, { message: `All versions of policy '${name}' deleted successfully` });
    }
    return json(404, { detail: 'not found' });
  });

  return { ...record, versions: () => rows.map((row) => ({ ...row })) };
};
