/**
 * All four Paperless taxonomy providers.
 *
 *     Layer.mergeAll(paperlessProviders(), …the stack's other providers)
 *
 * ⚠️ `HttpClient.HttpClient` IS NOT BUNDLED HERE, and that follows `../netbox/index.ts` and
 *   `../forgejo/client.ts`'s own precedent: the transport is the consuming STACK's choice
 *   (`FetchHttpClient.layer` in production, a fake `HttpClient` in a test), not a house default a
 *   provider file should pin.
 *
 * 🔴 NO `credentials` PARAMETER ANY MORE (2026-09-24, the `@distilled.cloud/paperless-ngx`
 *   migration — see `matching.ts`'s header). Each of the four `xxxProvider()`s now bakes in
 *   `CredentialsFromEnv` itself, the same way `netboxHandlers`/`forgejoHandlers` do — there is no
 *   longer a layer for this file to merge in or accept an override for. Nothing in this estate
 *   called `paperlessProviders(customLayer)` (measured 2026-09-24: no tray repo declares a
 *   Paperless resource at all — grep across `homeflare-landscape`'s tray repos' `origin/main`),
 *   so this is an uneventful simplification, not a behaviour change for anything live.
 */
import * as Layer from 'effect/Layer';
import { CustomFieldProvider } from './custom-field.ts';
import { DocumentTypeProvider } from './document-type.ts';
import { StoragePathProvider } from './storage-path.ts';
import { TagProvider } from './tag.ts';

export const paperlessProviders = () =>
  Layer.mergeAll(
    TagProvider(),
    DocumentTypeProvider(),
    StoragePathProvider(),
    CustomFieldProvider(),
  );
