/**
 * OPNsense providers for Alchemy — READ-ONLY (policy.ts). `reconcile` and `delete` on every
 * resource here always refuse; this family exists to plan and adopt against the live edge,
 * never to change it.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY.
 *   `resource.ts`, `wire.ts`, `policy.ts` and the three `*-form.ts` files are internals every
 *   resource file shares — a consumer builds against the three resources and `providers()`.
 */
export {
  firewallAlias,
  isOpnsenseFirewallAlias,
  OpnsenseFirewallAlias,
  OpnsenseFirewallAliasProvider,
  propsFromLive as aliasPropsFromLive,
  type AliasAttributes,
  type AliasProps,
} from './alias.ts';
export {
  firewallCategory,
  isOpnsenseFirewallCategory,
  OpnsenseFirewallCategory,
  OpnsenseFirewallCategoryProvider,
  propsFromLive as categoryPropsFromLive,
  type CategoryAttributes,
  type CategoryProps,
} from './category.ts';
export {
  firewallGroup,
  isOpnsenseFirewallGroup,
  OpnsenseFirewallGroup,
  OpnsenseFirewallGroupProvider,
  propsFromLive as groupPropsFromLive,
  type GroupAttributes,
  type GroupProps,
} from './group.ts';
export {
  Credentials,
  CredentialsFromEnv,
  type OpnsenseCredentialsConfig,
  credentials,
  fromEnv,
} from './credentials.ts';
export { OpnsenseWriteRefused, type OpnsenseWriteAction } from './policy.ts';
export { providers } from './providers.ts';
