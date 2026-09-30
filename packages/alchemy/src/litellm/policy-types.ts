/**
 * What a `LiteLLM.Policy` declares (props) and what is remembered about it (attributes).
 *
 * ★ A POLICY IS A NAMED SET OF GUARDRAILS (`LiteLLM_PolicyTable`, `/policies`;
 *   docs.litellm.ai/docs/proxy/guardrails/guardrail_policies): guardrails to add, guardrails to remove
 *   from an inherited parent, and an optional model condition. WHERE it applies is a
 *   `LiteLLM.PolicyAttachment`, not a property of the policy.
 * ⛔ A POLICY IS VERSIONED, AND THIS RESOURCE MANAGES THE PRODUCTION VERSION. LiteLLM keeps every
 *   version (`draft` → `published` → `production`) and only the production one is enforced. `POST /policies`
 *   creates version 1 AS PRODUCTION, and `PUT /policies/{id}` edits a DRAFT only (400 otherwise;
 *   `policy_endpoints.py` and `policy_registry.py`, 1.103.0). So a change is four calls: new draft from
 *   production, edit the draft, publish it, promote it (which demotes the old production to `published`).
 *   The old version is kept as history. `policyId` in the attributes is the PRODUCTION version's id and
 *   changes with every promotion.
 * ⚠️ NOT MODELLED: `pipeline` (an ordered guardrail pipeline). A new version is cloned from production,
 *   so an adopted policy's pipeline survives every update, and none is ever sent.
 * ⚠️ A FIELD CANNOT BE CLEARED THROUGH THE API. `update_policy_in_db` writes only fields that are not
 *   `None`, so `description`, `inherit` and `conditionModel` are compared only when declared and
 *   removing one from the declaration leaves the live value. The two guardrail lists can be written as
 *   `[]`, so they are always compared.
 */
export interface PolicyProps {
  /**
   * The policy's name, and the way an existing policy is ADOPTED: its production version, found by
   * name. Identity: a different name is a different policy, so it is a replace (create-first).
   */
  readonly policyName: string;
  /** Compared only when declared. Blank is refused. */
  readonly description?: string;
  /** The parent policy's name. Compared only when declared. Refused if it is this policy's own name. */
  readonly inherit?: string;
  /** Guardrail names this policy adds, compared as a SET and always compared (default `[]`). */
  readonly guardrailsAdd?: readonly string[];
  /** Guardrail names removed from the inherited set, compared as a set, always compared (default `[]`). */
  readonly guardrailsRemove?: readonly string[];
  /**
   * `condition.model`: the model name (exact or regex) the policy applies to. Compared only when
   * declared. Written as the whole condition (`PolicyConditionRequest` has no other key).
   */
  readonly conditionModel?: string;
}

export interface PolicyAttributes {
  readonly policyName: string;
  /** The PRODUCTION version's id. */
  readonly policyId: string;
  readonly versionNumber: number;
  readonly description: string | null;
  readonly inherit: string | null;
  readonly guardrailsAdd: readonly string[];
  readonly guardrailsRemove: readonly string[];
  readonly conditionModel: string | null;
}

/** One version of a policy, as the version list returns it. */
export interface PolicyVersion extends PolicyAttributes {
  readonly versionStatus: string;
}
