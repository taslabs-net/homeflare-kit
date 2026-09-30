/**
 * A fake of LiteLLM's `/team/*` routes for tests — TEST ONLY. Skeleton and the rules every fake
 * follows: fake-registry-base.ts.
 *
 * ★ MEASURED FROM THE LIVE 1.103.0 CONTAINER'S SOURCE (2026-09-30, `team_endpoints.py`,
 *   `object_permission_utils.py`, read, not called): `/team/new` refuses a taken id (400) and ADDS THE
 *   CALLER AS AN `admin` MEMBER (`_should_auto_add_team_creator`), which `autoAddsCreator` models;
 *   `/team/update` is partial (`exclude_unset`) and merges `object_permission` BY TOP-LEVEL FIELD (a
 *   field left out keeps its value, `[]` replaces it); `/team/info` answers a missing team 404 in the
 *   `ProxyException` envelope; `member_add` and `member_update` refuse an `admin` role on a proxy
 *   without a licence (400, `community`, the default); `/team/delete` 404s a missing team and DELETES THE
 *   TEAM'S KEYS (`deletedKeys` records that); `/team/member_delete` is not modelled because nothing here
 *   may call it, and any request to it is recorded so a test can assert none was made.
 * ★ ALSO MEASURED: `/team/info` and `/team/delete` answer 404 for ANY exception on the lookup, database
 *   errors included, which `infoLies` and `deleteLies` model (the team exists and the answer is 404).
 * ⚠️ NOT MODELLED: budgets, metadata, the Enterprise fields, `access_group` mirroring into groups.
 */
import { FAKE_KEY, type FakeRecord, json, recordingFetch } from './fake-registry-base.ts';
import type { Row } from './registry-support.ts';

export interface FakeTeamLitellm extends FakeRecord {
  /** Every stored team, exactly as the proxy holds it (`object_permission` included). */
  readonly teams: () => readonly Row[];
  /** Team ids whose keys a `/team/delete` removed, in order. */
  readonly deletedKeys: () => readonly string[];
}

export interface FakeTeamOptions {
  readonly masterKey?: string;
  readonly seed?: readonly Row[];
  /** No licence: an `admin` role is a 400. Default `true`. */
  readonly community?: boolean;
  /** `/team/new` adds the caller as an admin member. Default `true` (measured). */
  readonly autoAddsCreator?: boolean;
  /** `/team/info` answers 404 whether or not the team exists (a swallowed database error). */
  readonly infoLies?: boolean;
  /** `/team/delete` answers 404 whether or not the team exists. */
  readonly deleteLies?: boolean;
  /** `mcp_tool_permissions` comes back as a JSON string, as the source says it can. */
  readonly toolPermissionsAsString?: boolean;
  /**
   * `/team/info` also carries what a real one does and a resource must never copy: the team's KEYS
   * (`FAKE-hashed-key`), its memberships, and metadata that can hold callback variables.
   */
  readonly leaky?: boolean;
}

export const teamRow = (fields: Row): Row => ({
  access_group_ids: [],
  blocked: false,
  members_with_roles: [],
  models: [],
  object_permission: null,
  ...fields,
});

const CALLER = 'default_user_id';

const notFound = (id: string) =>
  json(404, {
    error: {
      code: '404',
      message: `Team not found, passed team id: ${id}.`,
      param: 'None',
      type: 'auth_error',
    },
  });

/** `{**existing, **sent}`: the merge by top-level field `prepare_object_permission_upsert` does. */
const mergePermission = (existing: unknown, sent: unknown): Row => ({
  ...(existing as Row | null),
  ...(sent as Row | null),
});

export const startFakeTeamLitellm = (options: FakeTeamOptions = {}): FakeTeamLitellm => {
  let rows: Row[] = (options.seed ?? []).map((row) => ({ ...row }));
  const deletedKeys: string[] = [];
  const community = options.community ?? true;

  const info = (row: Row): Row => {
    const permission = row['object_permission'] as Row | null;
    const shown =
      permission !== null &&
      options.toolPermissionsAsString === true &&
      permission['mcp_tool_permissions'] !== undefined
        ? {
            ...permission,
            mcp_tool_permissions: JSON.stringify(permission['mcp_tool_permissions']),
          }
        : permission;
    return {
      keys: [],
      team_id: row['team_id'],
      team_info: { ...row, object_permission: shown },
      team_memberships: [],
    };
  };

  const record = recordingFetch(options.masterKey ?? FAKE_KEY, ({ body, request, url }) => {
    if (url.pathname === '/team/info' && request.method === 'GET') {
      const id = url.searchParams.get('team_id') ?? '';
      const row = rows.find((each) => each['team_id'] === id);
      return row === undefined || options.infoLies === true ? notFound(id) : json(200, info(row));
    }
    if (url.pathname === '/team/list' && request.method === 'GET') return json(200, rows);
    if (url.pathname === '/team/new' && request.method === 'POST') {
      const id = String(body['team_id']);
      if (rows.some((row) => row['team_id'] === id)) {
        return json(400, {
          detail: { error: `Team id = ${id} already exists. Please use a different team id.` },
        });
      }
      const members =
        options.autoAddsCreator === false
          ? []
          : [{ role: 'admin', user_email: null, user_id: CALLER }];
      const { object_permission: permission, ...rest } = body;
      rows = [
        ...rows,
        teamRow({
          ...rest,
          members_with_roles: members,
          object_permission: permission === undefined ? null : mergePermission(null, permission),
        }),
      ];
      return json(200, rows.at(-1));
    }
    if (url.pathname === '/team/update' && request.method === 'POST') {
      const at = rows.findIndex((row) => row['team_id'] === body['team_id']);
      if (at === -1)
        return json(404, {
          detail: { error: `Team not found, passed team_id=${String(body['team_id'])}` },
        });
      const { object_permission: permission, team_id: _id, ...rest } = body;
      rows = rows.map((row, i) =>
        i === at
          ? {
              ...row,
              ...rest,
              ...(permission === undefined
                ? {}
                : { object_permission: mergePermission(row['object_permission'], permission) }),
            }
          : row,
      );
      return json(200, { data: rows[at], team_id: body['team_id'] });
    }
    if (url.pathname === '/team/member_add' && request.method === 'POST') {
      const at = rows.findIndex((row) => row['team_id'] === body['team_id']);
      if (at === -1) return json(404, { detail: { error: 'Team not found' } });
      const wanted = (Array.isArray(body['member']) ? body['member'] : [body['member']]) as Row[];
      if (community && wanted.some((member) => member['role'] === 'admin')) {
        return json(400, {
          detail: {
            error:
              'Assigning team admins is a premium feature. You must be a LiteLLM Enterprise user',
          },
        });
      }
      const roster = rows[at]?.['members_with_roles'] as Row[];
      const fresh = wanted.filter(
        (member) => !roster.some((each) => each['user_id'] === member['user_id']),
      );
      if (fresh.length === 0)
        return json(400, { error: { message: 'All users are already in team.' } });
      rows = rows.map((row, i) =>
        i === at
          ? {
              ...row,
              members_with_roles: [
                ...roster,
                ...fresh.map((member) => ({
                  role: member['role'],
                  user_email: null,
                  user_id: member['user_id'],
                })),
              ],
            }
          : row,
      );
      return json(200, rows[at]);
    }
    if (url.pathname === '/team/member_update' && request.method === 'POST') {
      const at = rows.findIndex((row) => row['team_id'] === body['team_id']);
      if (community && body['role'] === 'admin') {
        return json(
          400,
          'Assigning team admins is a premium feature. You must be a LiteLLM Enterprise user',
        );
      }
      const roster = (rows[at]?.['members_with_roles'] as Row[] | undefined) ?? [];
      if (at === -1 || !roster.some((each) => each['user_id'] === body['user_id'])) {
        return json(404, {
          detail: { error: `User ${String(body['user_id'])} is not a member of team` },
        });
      }
      rows = rows.map((row, i) =>
        i === at
          ? {
              ...row,
              members_with_roles: roster.map((each) =>
                each['user_id'] === body['user_id'] ? { ...each, role: body['role'] } : each,
              ),
            }
          : row,
      );
      return json(200, { team_id: body['team_id'] });
    }
    if (url.pathname === '/team/delete' && request.method === 'POST') {
      const ids = (body['team_ids'] as string[] | undefined) ?? [];
      const missing = ids.find((id) => !rows.some((row) => row['team_id'] === id));
      if (missing !== undefined || options.deleteLies === true) {
        return json(404, {
          detail: { error: `Team not found, passed team_id=${missing ?? ids[0] ?? ''}` },
        });
      }
      deletedKeys.push(...ids);
      rows = rows.filter((row) => !ids.includes(String(row['team_id'])));
      return json(200, {});
    }
    return json(404, { detail: 'not found' });
  });

  return {
    ...record,
    deletedKeys: () => [...deletedKeys],
    teams: () => rows.map((row) => ({ ...row })),
  };
};
