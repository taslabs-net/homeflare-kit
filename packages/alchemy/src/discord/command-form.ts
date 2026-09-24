/**
 * The wire body for a Discord command (global or guild), and the comparison that decides whether
 * it needs writing — shared by `application-command.ts` and `guild-application-command.ts` so the
 * two specs cannot drift on what "matches" means. Mirrors `../netbox/prefix-form.ts`: pure
 * functions of the props, extracted so a test can call them with a literal, no server involved.
 */
import { deepEqual } from 'alchemy/Diff';

/** Fields every Discord command shares, independent of global vs. guild scope. */
export interface CommandFields {
  readonly name: string;
  readonly description?: string;
  /**
   * ⚠️ GAP: passed through opaquely, not re-modeled. The SDK's generated option union is ~40
   *   nested schema types (subcommand, subcommand group, string/int/number/channel/role/user/
   *   mentionable/attachment, each with its own choices and localizations) — see
   *   `docs/upstream-conformance.md#discord`. A caller supplies the exact wire shape from
   *   Discord's own docs; this resource neither validates nor transforms it.
   */
  readonly options?: readonly Record<string, unknown>[];
  /** Bitfield, stringified, per Discord's real wire contract (the SDK types write as `number`). */
  readonly defaultMemberPermissions?: string;
  readonly dmPermission?: boolean;
  readonly contexts?: readonly number[];
  readonly integrationTypes?: readonly number[];
  readonly nsfw?: boolean;
  /** `ApplicationCommandType`; omitted means `1` (`CHAT_INPUT`), Discord's own default. */
  readonly type?: number;
}

export interface CommandFieldsAttributes {
  readonly name: string;
  readonly description: string;
  readonly options: readonly Record<string, unknown>[];
  readonly defaultMemberPermissions: string | undefined;
  readonly dmPermission: boolean | undefined;
  readonly contexts: readonly number[] | undefined;
  readonly integrationTypes: readonly number[] | undefined;
  readonly nsfw: boolean;
  readonly type: number;
}

const DEFAULT_TYPE = 1;

/** The fields an undeclared prop still settles to, because Discord itself would. */
const settled = (props: CommandFields) => ({
  description: props.description ?? '',
  nsfw: props.nsfw ?? false,
  type: props.type ?? DEFAULT_TYPE,
});

/**
 * ⛔ SENT IN FULL ON EVERY UPSERT, NEVER PARTIAL. Discord's create-as-upsert (resource.ts's own
 *   note) replaces the whole command, so a body that omitted a field the caller stopped declaring
 *   would never actually clear it — the same "declared, then forgotten" bug `prefix-form.ts`
 *   documents for NetBox's PATCH. Sending the full settled shape every time is what keeps a
 *   removed prop actually removed live, not just removed from the declaration.
 */
export const commandBody = (props: CommandFields): Record<string, unknown> => {
  const fixed = settled(props);
  const out: Record<string, unknown> = {
    description: fixed.description,
    name: props.name,
    nsfw: fixed.nsfw,
    type: fixed.type,
  };
  if (props.options !== undefined) out['options'] = props.options;
  if (props.defaultMemberPermissions !== undefined) {
    out['default_member_permissions'] = props.defaultMemberPermissions;
  }
  if (props.dmPermission !== undefined) out['dm_permission'] = props.dmPermission;
  if (props.contexts !== undefined) out['contexts'] = props.contexts;
  if (props.integrationTypes !== undefined) out['integration_types'] = props.integrationTypes;
  return out;
};

/** Whether the live command already says what the declaration says. */
export const commandMatches = (
  attributes: CommandFieldsAttributes,
  props: CommandFields,
): boolean => {
  const fixed = settled(props);
  return (
    attributes.name === props.name &&
    attributes.description === fixed.description &&
    attributes.nsfw === fixed.nsfw &&
    attributes.type === fixed.type &&
    // ⛔ GATED LIKE EVERY OTHER OPTIONAL FIELD BELOW — an undeclared `options` means "not mine",
    //   in both directions (this file's own header rule). An earlier version of this line
    //   compared unconditionally against `props.options ?? []`: a declaration with no `options`
    //   at all would then see live options as drift, `commandBody` (which already omits
    //   `options` when undeclared) would upsert without it, and Discord's real full-replace
    //   create would silently wipe a live command's arguments on the first non-dry-run deploy.
    //   Caught in review before merge, not measured live.
    (props.options === undefined || deepEqual(attributes.options, props.options)) &&
    (props.defaultMemberPermissions === undefined ||
      attributes.defaultMemberPermissions === props.defaultMemberPermissions) &&
    (props.dmPermission === undefined || attributes.dmPermission === props.dmPermission) &&
    (props.contexts === undefined || deepEqual(attributes.contexts, props.contexts)) &&
    (props.integrationTypes === undefined ||
      deepEqual(attributes.integrationTypes, props.integrationTypes))
  );
};

/**
 * Reads the shared fields off any `ApplicationCommandResponse`-shaped object.
 *
 * ⚠️ `options` IS READ AS `readonly unknown[]`, NOT RE-TYPED. The SDK's real
 *   `ApplicationCommandResponseOptionsItem` union has no index signature (each option kind is a
 *   distinct generated interface), so it cannot structurally satisfy `Record<string, unknown>`
 *   without a cast — the same "opaque passthrough" gap `CommandFields.options` documents above.
 */
export const commandFieldsOf = (live: {
  readonly name: string;
  readonly description: string;
  readonly options?: readonly unknown[] | null | undefined;
  readonly default_member_permissions?: string | null | undefined;
  readonly dm_permission?: boolean | undefined;
  readonly contexts?: readonly number[] | null | undefined;
  readonly integration_types?: readonly number[] | null | undefined;
  readonly nsfw?: boolean | undefined;
  readonly type: number;
}): CommandFieldsAttributes => ({
  contexts: live.contexts ?? undefined,
  defaultMemberPermissions: live.default_member_permissions ?? undefined,
  description: live.description,
  dmPermission: live.dm_permission,
  integrationTypes: live.integration_types ?? undefined,
  name: live.name,
  nsfw: live.nsfw === true,
  options: (live.options as readonly Record<string, unknown>[] | null | undefined) ?? [],
  type: live.type,
});
