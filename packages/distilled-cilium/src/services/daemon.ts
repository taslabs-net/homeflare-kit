/**
 * STUB — one Cilium agent API operation so Alchemy can start wiring against
 * `@distilled.cloud/cilium` after publish. This is not generated quality.
 * `src/` will be replaced by a regenerate+copy from
 * `https://raw.githubusercontent.com/cilium/cilium/main/api/v1/openapi.yaml`.
 *
 * `getHealthz` is `GET /v1/healthz` (swagger path `/healthz`, basePath `/v1`,
 * tag `daemon`). Official spec: cilium/cilium `api/v1/openapi.yaml`.
 */
import * as API from '@distilled.cloud/core/api';
import * as S from '@distilled.cloud/core/schema';
import * as T from '../traits.ts';
import { CiliumProtocol, type CiliumOpContext, type CiliumOpError } from '../protocol.ts';
import { UnknownCiliumError } from '../errors.ts';
import * as Retry from '../retry.ts';

export type { CiliumOpContext, CiliumOpError };

export interface Status {
  state?: string;
  msg?: string;
}
export const Status = /*@__PURE__*/ S.suspend(() =>
  S.Struct({
    state: S.optional(S.String),
    msg: S.optional(S.String),
  }),
).annotate({ identifier: 'Status' }) as any as S.Schema<Status>;

export interface GetHealthzRequest {}
export const GetHealthzRequest = /*@__PURE__*/ S.suspend(() =>
  S.Struct({}).pipe(T.Http({ method: 'GET', uri: '/v1/healthz', code: 200 })),
).annotate({
  identifier: 'GetHealthzRequest',
}) as any as S.Schema<GetHealthzRequest>;

export interface StatusResponse {
  cilium?: Status;
}
export const StatusResponse = /*@__PURE__*/ S.suspend(() =>
  S.Struct({
    cilium: S.optional(Status),
  }),
).annotate({ identifier: 'StatusResponse' }) as any as S.Schema<StatusResponse>;

export type GetHealthzError = CiliumOpError;
/** STUB. GET /v1/healthz — Cilium agent API (`daemon` tag). */
export const getHealthz: API.OperationMethod<
  GetHealthzRequest,
  StatusResponse,
  GetHealthzError,
  CiliumOpContext
> = /*@__PURE__*/ API.make(() => ({
  input: GetHealthzRequest,
  output: StatusResponse,
  errors: [UnknownCiliumError],
  protocol: CiliumProtocol,
  retry: Retry.Retry,
}));
