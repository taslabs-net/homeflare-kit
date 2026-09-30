/**
 * A fake of LiteLLM's `/policies/attachments` routes for tests — TEST ONLY. Skeleton and the rules
 * every fake follows: fake-registry-base.ts.
 *
 * ★ MEASURED FROM THE LIVE 1.103.0 CONTAINER'S SOURCE (2026-09-30, `policy_endpoints.py` and
 *   `attachment_registry.py`, read, not called): a create needs the policy to have a PRODUCTION version
 *   (404 otherwise), refuses a CONCRETE team, key or model selector that resolves to nothing (400;
 *   wildcards are let through), and answers the row with a proxy-issued id; the list merges in config.yaml
 *   attachments (`definition_location: "config"`, ids `config-<n>`); a delete of a missing id is a 404.
 *   There is NO update route, and the fake answers 405 to one so a resource that tried would fail.
 * ⚠️ NOT MODELLED: the in-memory registry and how a request is matched (`policy_matcher.py`).
 */
import { FAKE_KEY, type FakeRecord, json, recordingFetch } from './fake-registry-base.ts';
import type { Row } from './registry-support.ts';

export interface FakePolicyAttachmentLitellm extends FakeRecord {
  /** Every stored database attachment, exactly as the proxy holds it. */
  readonly attachments: () => readonly Row[];
}

export interface FakePolicyAttachmentOptions {
  readonly masterKey?: string;
  readonly seed?: readonly Row[];
  /** Policies that have a production version. A create for any other name is a 404. */
  readonly policies?: readonly string[];
  /** Team aliases that exist. A concrete (non-wildcard) `teams` entry outside this set is a 400. */
  readonly knownTeams?: readonly string[];
  /** Attachments defined in config.yaml: they appear in the list and can never be deleted. */
  readonly configAttachments?: readonly Row[];
  /** `DELETE` answers 403, as for a key that is not allowed. */
  readonly forbidDelete?: boolean;
}

export const attachmentRow = (fields: Row): Row => ({
  keys: [],
  models: [],
  priority: null,
  scope: null,
  tags: [],
  teams: [],
  ...fields,
});

export const startFakePolicyAttachmentLitellm = (
  options: FakePolicyAttachmentOptions = {},
): FakePolicyAttachmentLitellm => {
  let rows: Row[] = (options.seed ?? []).map((row) => ({ ...row }));
  let issued = 0;

  const record = recordingFetch(options.masterKey ?? FAKE_KEY, ({ body, request, url }) => {
    const byId = /^\/policies\/attachments\/([^/]+)$/.exec(url.pathname);
    if (url.pathname === '/policies/attachments/list' && request.method === 'GET') {
      const config = (options.configAttachments ?? []).map((row, index) =>
        attachmentRow({ attachment_id: `config-${index}`, definition_location: 'config', ...row }),
      );
      const all = [...rows, ...config];
      return json(200, { attachments: all, total_count: all.length });
    }
    if (url.pathname === '/policies/attachments' && request.method === 'POST') {
      if (!(options.policies ?? []).includes(String(body['policy_name']))) {
        return json(404, {
          detail: `Policy '${String(body['policy_name'])}' not found. Create the policy first.`,
        });
      }
      const teams = (body['teams'] as string[] | undefined) ?? [];
      const missing = teams.filter(
        (team) => !team.includes('*') && !(options.knownTeams ?? []).includes(team),
      );
      if (missing.length > 0) return json(400, { detail: `Unknown team: ${missing.join(', ')}` });
      issued += 1;
      const created = attachmentRow({
        attachment_id: `FAKE-attachment-${String(issued).padStart(4, '0')}`,
        keys: body['keys'] ?? [],
        models: body['models'] ?? [],
        policy_name: body['policy_name'],
        priority: body['priority'] ?? null,
        scope: body['scope'] ?? null,
        tags: body['tags'] ?? [],
        teams,
      });
      rows = [...rows, created];
      return json(200, created);
    }
    if (byId !== null && request.method === 'DELETE') {
      const id = decodeURIComponent(byId[1] ?? '');
      if (options.forbidDelete === true) return json(403, { detail: 'not_allowed_access' });
      if (!rows.some((row) => row['attachment_id'] === id)) {
        return json(404, { detail: `Attachment with ID ${id} not found` });
      }
      rows = rows.filter((row) => row['attachment_id'] !== id);
      return json(200, { message: `Attachment ${id} deleted successfully` });
    }
    return json(405, { detail: `unhandled ${request.method} ${url.pathname}` });
  });

  return { ...record, attachments: () => rows.map((row) => ({ ...row })) };
};
