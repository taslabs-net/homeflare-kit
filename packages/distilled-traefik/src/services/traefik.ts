/**
 * STUB — one Traefik dashboard API operation so Alchemy can start wiring
 * against `@distilled.cloud/traefik` after publish. This is not generated
 * quality. `src/` will be replaced by a regenerate+copy.
 *
 * `getVersion` is `GET /api/version` — documented on Traefik's API page,
 * no official OpenAPI. Response field names match Go's default JSON
 * (`Version`, `Codename`, `StartDate`).
 */
import * as API from '@distilled.cloud/core/api';
import * as S from '@distilled.cloud/core/schema';
import * as T from '../traits.ts';
import {
  TraefikProtocol,
  type TraefikOpContext,
  type TraefikOpError,
} from '../protocol.ts';
import { UnknownTraefikError } from '../errors.ts';
import * as Retry from '../retry.ts';

export type { TraefikOpContext, TraefikOpError };

export interface GetVersionRequest {}
export const GetVersionRequest = /*@__PURE__*/ S.suspend(() =>
  S.Struct({}).pipe(T.Http({ method: 'GET', uri: '/api/version', code: 200 })),
).annotate({
  identifier: 'GetVersionRequest',
}) as any as S.Schema<GetVersionRequest>;

export interface VersionInfo {
  Version?: string;
  Codename?: string;
  StartDate?: string;
}
export const VersionInfo = /*@__PURE__*/ S.suspend(() =>
  S.Struct({
    Version: S.optional(S.String),
    Codename: S.optional(S.String),
    StartDate: S.optional(S.String),
  }),
).annotate({ identifier: 'VersionInfo' }) as any as S.Schema<VersionInfo>;

export type GetVersionError = TraefikOpError;
/** STUB. GET /api/version — Traefik dashboard API. */
export const getVersion: API.OperationMethod<
  GetVersionRequest,
  VersionInfo,
  GetVersionError,
  TraefikOpContext
> = /*@__PURE__*/ API.make(() => ({
  input: GetVersionRequest,
  output: VersionInfo,
  errors: [UnknownTraefikError],
  protocol: TraefikProtocol,
  retry: Retry.Retry,
}));
