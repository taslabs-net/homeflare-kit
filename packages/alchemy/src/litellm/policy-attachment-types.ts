/**
 * What a `LiteLLM.PolicyAttachment` declares (props) and what is remembered about it (attributes).
 *
 * ★ AN ATTACHMENT SAYS WHERE A POLICY APPLIES (`LiteLLM_PolicyAttachmentTable`,
 *   `/policies/attachments`): a request gets the policy when it matches ALL of the attachment's
 *   selectors (`PolicyMatcher.scope_matches`, `policy_engine/policy_matcher.py`, 1.103.0). Teams, keys
 *   and models are matched by ALIAS or model name with `*` wildcards (`prefix-*`); a request's team
 *   alias is `LiteLLM.Team`'s `teamAlias`, not its id.
 * ⛔ AN ATTACHMENT WITH NO SELECTOR IS GLOBAL. `PolicyScope.get_teams()`, `get_keys()` and
 *   `get_models()` each default to `["*"]` when empty, and empty `tags` are simply not checked
 *   (`policy_types.py`), so an attachment that names only a policy applies to EVERY request. It is
 *   refused unless `scope: '*'` says so. The other three empty selectors are "any", which is why
 *   `{ teams: ['x'] }` covers every key and every model of team x.
 * ⛔ IMMUTABLE: THERE IS NO UPDATE ROUTE (`policy_endpoints.py` has create, get, list and delete only).
 *   Any change is a REPLACE: the new attachment is created first, then the old one is deleted, so for a
 *   moment both apply. Guardrails are additive, so overlap can only add enforcement, never drop it.
 * ★ IDENTITY IS CONTENT. The id is issued by the proxy and there is no name, so a live attachment is
 *   adopted by matching every field (policy, scope, the four selector sets, priority).
 * ⚠️ CONFIG-FILE ATTACHMENTS (`config-<n>` ids) are never adopted or deleted: they cannot be removed
 *   through the API.
 */
export interface PolicyAttachmentProps {
  /** The policy to attach, by name. The proxy refuses a name with no PRODUCTION version (404). */
  readonly policyName: string;
  /** `'*'` for a global attachment. Declare this OR a selector; neither is refused (see above). */
  readonly scope?: '*';
  /** Team ALIASES or patterns. A set. */
  readonly teams?: readonly string[];
  /** Key aliases or patterns. A set. */
  readonly keys?: readonly string[];
  /** Model names or patterns. A set. */
  readonly models?: readonly string[];
  /** Tag patterns matched against key and team `metadata.tags`. A set. */
  readonly tags?: readonly string[];
  /** Explicit execution order, lower first; an attachment with one runs before those without. 32-bit int. */
  readonly priority?: number;
}

export interface PolicyAttachmentAttributes {
  readonly attachmentId: string;
  readonly policyName: string;
  readonly scope: string | null;
  readonly teams: readonly string[];
  readonly keys: readonly string[];
  readonly models: readonly string[];
  readonly tags: readonly string[];
  readonly priority: number | null;
}
