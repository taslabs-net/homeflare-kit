/**
 * STUB — CiliumProtocol. Hand-written scaffold; replaced when `src/` is
 * regenerated. The agent API is JSON REST with no response envelope and no
 * HTTP auth, so this is one `makeRestProtocol` call.
 *
 * request:  credentials → `Accept: application/json`. Paths already include
 *           `/v1/…`. Unix-socket dial is the caller's HttpClient.
 * response: 2xx JSON is the payload; non-2xx maps to core status classes,
 *           then {@link UnknownCiliumError}.
 */
import type * as API from '@distilled.cloud/core/api';
import type { API_ERRORS, ConfigError } from '@distilled.cloud/core/errors';
import { makeRestProtocol } from '@distilled.cloud/core/protocol-rest';
import * as Effect from 'effect/Effect';
import type * as Layer from 'effect/Layer';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type * as HttpClientError from 'effect/unstable/http/HttpClientError';
import { Credentials, type Config } from './credentials.ts';
import { UnknownCiliumError } from './errors.ts';

export type CiliumOpError =
  | InstanceType<(typeof API_ERRORS)[number]>
  | UnknownCiliumError
  | ConfigError
  | HttpClientError.HttpClientError;

export type CiliumOpContext = Credentials | HttpClient.HttpClient;

export const CiliumProtocol: Layer.Layer<API.Protocol> = makeRestProtocol<Config>({
  credentials: Effect.gen(function* () {
    const resolve = yield* Credentials;
    return yield* resolve;
  }),
  baseUrl: (creds) => creds.apiBaseUrl,
  headers: () => ({ Accept: 'application/json' }),
  unknownError: ({ code, message, body }) =>
    new UnknownCiliumError({
      code: typeof code === 'string' ? code : code !== undefined ? String(code) : undefined,
      message,
      body,
    }),
});
