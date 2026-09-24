/**
 * All three OPNsense firewall providers as one layer for a stack.
 *
 *     Layer.mergeAll(opnsenseProviders(), …the stack's other providers)
 *       .pipe(Layer.provide(FetchHttpClient.layer))
 *
 * S16: a subpath's `providers()` plays the role upstream's own `Providers.ts` does — one minimal
 * insertion per family, requirements that never contain `unknown`. `FetchHttpClient.layer` is
 * the stack's own responsibility to provide, mirroring `../discord/providers.ts`.
 */
import * as Layer from 'effect/Layer';
import { OpnsenseFirewallAliasProvider } from './alias.ts';
import { OpnsenseFirewallCategoryProvider } from './category.ts';
import { OpnsenseFirewallGroupProvider } from './group.ts';

export const providers = () =>
  Layer.mergeAll(
    OpnsenseFirewallAliasProvider(),
    OpnsenseFirewallCategoryProvider(),
    OpnsenseFirewallGroupProvider(),
  );
