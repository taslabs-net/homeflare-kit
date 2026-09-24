/**
 * Both Discord command providers as one layer for a stack.
 *
 *     Layer.mergeAll(discordProviders(), …the stack's other providers)
 *       .pipe(Layer.provide(FetchHttpClient.layer))
 *
 * S16: a subpath's `providers()` plays the role upstream's own `Providers.ts` does — one minimal
 * insertion per family, requirements that never contain `unknown`. `FetchHttpClient.layer` is the
 * stack's own responsibility to provide (it is the shared transport every family needs, not
 * something a single vendor's `providers()` should pin), mirroring `../netbox/index.ts`'s barrel,
 * which exports `netboxHandlers` rather than a bundled transport too.
 */
import * as Layer from 'effect/Layer';
import { DiscordApplicationCommandProvider } from './application-command.ts';
import { DiscordGuildApplicationCommandProvider } from './guild-application-command.ts';

export const providers = () =>
  Layer.mergeAll(DiscordApplicationCommandProvider(), DiscordGuildApplicationCommandProvider());
