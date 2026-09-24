/**
 * STUB — TraefikProtocol. Hand-written scaffold; replaced when `src/` is
 * regenerated. Traefik's dashboard API is read-only JSON REST with no
 * response envelope, so this is one `makeRestProtocol` call.
 *
 * request:  credentials → optional `Authorization` (front-door middleware)
 *           + `Accept: application/json`. Paths already include `/api/…`.
 * response: 2xx JSON is the payload; non-2xx maps to core status classes,
 *           then {@link UnknownTraefikError}.
 */
import type * as API from '@distilled.cloud/core/api';
import type { API_ERRORS, ConfigError } from '@distilled.cloud/core/errors';
import { makeRestProtocol } from '@distilled.cloud/core/protocol-rest';
import * as Effect from 'effect/Effect';
import type * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type * as HttpClientError from 'effect/unstable/http/HttpClientError';
import { Credentials, type Config } from './credentials.ts';
import { UnknownTraefikError } from './errors.ts';

export type TraefikOpError =
  | InstanceType<(typeof API_ERRORS)[number]>
  | UnknownTraefikError
  | ConfigError
  | HttpClientError.HttpClientError;

export type TraefikOpContext = Credentials | HttpClient.HttpClient;

export const TraefikProtocol: Layer.Layer<API.Protocol> = makeRestProtocol<Config>({
  credentials: Effect.gen(function* () {
    const resolve = yield* Credentials;
    return yield* resolve;
  }),
  baseUrl: (creds) => creds.apiBaseUrl,
  headers: (creds) => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (creds.authorization !== undefined) {
      headers.Authorization = Redacted.value(creds.authorization);
    }
    return headers;
  },
  unknownError: ({ code, message, body }) =>
    new UnknownTraefikError({
      code: typeof code === 'string' ? code : code !== undefined ? String(code) : undefined,
      message,
      body,
    }),
});
