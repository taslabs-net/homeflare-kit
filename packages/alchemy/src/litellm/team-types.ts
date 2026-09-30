/**
 * What a `LiteLLM.Team` declares (props) and what is remembered about it (attributes).
 *
 * ★ A TEAM (`LiteLLM_TeamTable`, `/team/*`) owns keys, a member roster and an ACCESS CEILING: the
 *   models it may use, and an `object_permission` that says which MCP servers, MCP access groups,
 *   toolsets and tools its keys may reach. This resource manages exactly those, plus the team's
 *   attachment to unified access groups. Nothing else about a team is touched.
 * ⛔ THE TEAM'S `mcpServers` LIST IS A CEILING THAT INTERSECTS EVERY KEY'S OWN GRANTS. Where both a team
 *   and a key list servers, the key reaches only the intersection
 *   (`user_api_key_auth_mcp.py` lines 1482-1503, 1.103.0; docs.litellm.ai/docs/mcp_grant_access). A
 *   NON-EMPTY team list therefore silently removes access from any key that was granted a server the
 *   team does not list, and `[]` is "this level does not restrict". Grant servers on keys, toolsets
 *   (`mcpToolsets`) or unified access groups, and leave the team's list `[]`, unless a ceiling is meant.
 * ⛔ `models: []` MEANS EVERY MODEL, not none (LiteLLM's own field doc: "If empty, assumes all models
 *   are allowed"). Compared only when declared.
 * ⚠️ NOT MODELLED, on purpose, so an adopted team keeps them and none is ever sent: budgets and rate
 *   limits (a team's `max_budget` is a HARD cap that 429s every key, the 2026-09-28 incident), the
 *   metadata-backed fields (`guardrails`, `policies`, `tags`, `prompts`, `logging`,
 *   `secret_manager_settings`, `allowed_passthrough_routes`, `team_member_key_duration`,
 *   `disable_global_guardrails` — Enterprise, each a 403 when set on a proxy without a licence,
 *   `common_utils.py` line 463 and `_types.py` lines 4843-4853), `model_max_budget` (Enterprise, 403,
 *   `common_utils.py` lines 73-86), `metadata`, `router_settings`, `model_aliases`, organisation and the
 *   other `object_permission` fields (vector stores, agents, models, search tools, skills).
 */

/** The object permission fields this resource manages. Each one is compared and sent ONLY WHEN DECLARED. */
export interface TeamObjectPermission {
  /**
   * MCP servers the team's keys may reach, by `server_id`, alias or name. ⛔ A ceiling: see above.
   * `[]` clears the list. The sentinel `all-proxy-mcpservers` is refused (Proxy admin only,
   * `object_permission_utils.py` line 480, and it grants every server).
   */
  readonly mcpServers?: readonly string[];
  /** MCP access group NAMES (the bare names on MCP server rows), not unified access group ids. */
  readonly mcpAccessGroups?: readonly string[];
  /** Toolset IDS (`toolset.toolsetId` of a `LiteLLM.Toolset`), not names. */
  readonly mcpToolsets?: readonly string[];
  /** Per-server tool allowlist: `server_id` (or alias or name) to the tools it may call. */
  readonly mcpToolPermissions?: Readonly<Record<string, readonly string[]>>;
  /**
   * Tool names blocked for this team. ⚠️ The same list `POST /v1/tool/policy` writes for a team override,
   * which is why `LiteLLM.ToolPolicy` does not model overrides.
   */
  readonly blockedTools?: readonly string[];
}

export interface TeamMember {
  /** The user's `user_id`. A member is added by id only: an email would make LiteLLM allocate the id. */
  readonly userId: string;
  /** Default `user`. `admin` is an ENTERPRISE feature (400 on a proxy without a licence). */
  readonly role?: 'user' | 'admin';
}

export interface TeamProps {
  /** The team's alias. Not unique in LiteLLM (a policy attachment matches it as a pattern). Always compared. */
  readonly teamAlias: string;
  /**
   * The team's id. Set it to ADOPT an existing team (it needs `--adopt`); without it a deterministic
   * physical name is used for a create. ⛔ A DIFFERENT DECLARED ID IS A REPLACE (create-first, so the old
   * team is only removed by an opt-in `RemovalPolicy.destroy()`, which also deletes its keys).
   */
  readonly teamId?: string;
  /** Models the team's keys may use, compared as a set, only when declared. `[]` means every model. */
  readonly models?: readonly string[];
  /** Whether the team is blocked (every key stops). Compared only when declared. */
  readonly blocked?: boolean;
  /**
   * Unified access group ids the team is attached to (`accessGroup.accessGroupId`), compared as a set,
   * only when declared. LiteLLM mirrors it into each group's `assigned_team_ids` in the same transaction,
   * so `LiteLLM.AccessGroup` does not declare teams.
   */
  readonly accessGroupIds?: readonly string[];
  readonly objectPermission?: TeamObjectPermission;
  /**
   * Members that must exist, compared only when declared. ⛔ ADDITIVE ONLY: a live member the declaration
   * does not list is left alone, because `/team/member_delete` also DELETES the keys that user created
   * for the team (`team_endpoints.py` lines 3701-3748). A declared member with another role is updated.
   * Adding a member creates its user row when the id is new. `/team/new` itself adds the caller as an
   * `admin` member unless the proxy sets `disable_auto_add_proxy_admin_to_teams`.
   */
  readonly members?: readonly TeamMember[];
}

/** The object permission as a read returns it: every managed field, `[]` where LiteLLM holds none. */
export interface TeamObjectPermissionAttributes {
  readonly mcpServers: readonly string[];
  readonly mcpAccessGroups: readonly string[];
  readonly mcpToolsets: readonly string[];
  readonly mcpToolPermissions: Readonly<Record<string, readonly string[]>>;
  readonly blockedTools: readonly string[];
}

export interface TeamMemberAttributes {
  readonly userId: string;
  readonly role: string;
}

export interface TeamAttributes {
  readonly teamId: string;
  readonly teamAlias: string;
  readonly models: readonly string[];
  readonly blocked: boolean;
  readonly accessGroupIds: readonly string[];
  readonly objectPermission: TeamObjectPermissionAttributes;
  readonly members: readonly TeamMemberAttributes[];
}
