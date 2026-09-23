/**
 * All four Paperless taxonomy providers, one credentials layer shared between them.
 *
 *     Layer.mergeAll(paperlessProviders(), …the stack's other providers)
 *
 * ⚠️ `HttpClient.HttpClient` IS NOT BUNDLED HERE, and that follows `../netbox/index.ts` and
 *   `../forgejo/client.ts`'s own precedent (its header: "the idiom Alchemy's own providers
 *   follow — `Hetzner/Providers.ts` builds on `FetchHttpClient.layer`") rather than diverging
 *   from it: the transport is the consuming STACK's choice (`FetchHttpClient.layer` in
 *   production, a fake `HttpClient` in a test), not a house default a provider file should pin.
 */
import * as Layer from 'effect/Layer';
import { CustomFieldProvider } from './custom-field.ts';
import { DocumentTypeProvider } from './document-type.ts';
import { type PaperlessCredentials, environmentLayer } from './credentials.ts';
import { StoragePathProvider } from './storage-path.ts';
import { TagProvider } from './tag.ts';

export const paperlessProviders = (
  credentials: Layer.Layer<PaperlessCredentials> = environmentLayer,
) =>
  Layer.mergeAll(
    TagProvider(),
    DocumentTypeProvider(),
    StoragePathProvider(),
    CustomFieldProvider(),
  ).pipe(Layer.provide(credentials));
