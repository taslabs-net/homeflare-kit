/**
 * Every `Unifi.*` provider as one layer for a stack.
 *
 *     Layer.mergeAll(unifiProviders(), …the stack's other providers)
 *       .pipe(Layer.provide(FetchHttpClient.layer))
 *
 * S16: a subpath's `providers()` plays the role upstream's own `Providers.ts` does — one minimal
 * insertion per family. `FetchHttpClient.layer` is the stack's own responsibility to provide,
 * mirroring `../discord/providers.ts`.
 */
import * as Layer from 'effect/Layer';
import { UnifiFirewallZoneProvider } from './firewall-zone.ts';
import { UnifiNetworkProvider } from './network.ts';

export const providers = () => Layer.mergeAll(UnifiNetworkProvider(), UnifiFirewallZoneProvider());
