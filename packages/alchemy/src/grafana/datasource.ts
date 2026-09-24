/**
 * `Grafana.Datasource` — one Grafana data source, keyed by `uid`.
 *
 * ★ WHY `uid` IS REQUIRED, NOT GENERATED. `getDataSourceByUID`/`updateDataSourceByUID`/
 *   `deleteDataSourceByUID` are all UID-keyed, and `getDataSources` (list) takes no filter — so
 *   locating a datasource this resource didn't create means listing the whole org and matching by
 *   name, the same ambiguity netbox/resource.ts's `soleMatch` exists to catch. Requiring `uid` up
 *   front (Grafana accepts a caller-chosen one on create — `AddDataSourceRequest.uid`) sidesteps
 *   it entirely: `read`/`reconcile`/`destroy` all key on the one field the API itself is keyed on.
 *   `teslamate-grafana`'s live datasource (provisioned from a file, not this resource) has a
 *   Grafana-generated uid; the census in the handoff script records it so a first declaration can
 *   name it explicitly.
 *
 * ⛔ `secureJsonData` (e.g. a datasource password) NEVER APPEARS AS A LITERAL PROP (S25).
 *   `secureJsonDataRefs` takes env var NAMES instead; `resolveSecureJsonData` reads them from
 *   `process.env` fresh inside `create`/`update`'s own effect, never at plan time and never
 *   returned in `attributes` — Grafana's own read API agrees: `DataSource.secureJsonFields` on a
 *   GET is a map of booleans (is-it-set), never the value.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as grafana from '@distilled.cloud/grafana';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { type GrafanaSpec, grafanaHandlers } from './resource.ts';

export interface DatasourceProps {
  uid: string;
  name: string;
  /** e.g. `postgres`, `prometheus`, `influxdb` — the Grafana plugin id. */
  type: string;
  url?: string;
  access?: 'proxy' | 'direct';
  database?: string;
  user?: string;
  basicAuth?: boolean;
  basicAuthUser?: string;
  isDefault?: boolean;
  withCredentials?: boolean;
  jsonData?: Record<string, unknown>;
  /** Secure field name (e.g. `password`) -> env var NAME holding its value. Never the value. */
  secureJsonDataRefs?: Record<string, string>;
}

export interface DatasourceAttributes {
  uid: string;
  id: number;
  name: string;
  type: string;
  url: string;
  access: string;
  orgId: number;
  isDefault: boolean;
  readOnly: boolean;
  version: number;
}

export interface GrafanaDatasource extends Resource<
  'Grafana.Datasource',
  DatasourceProps,
  DatasourceAttributes,
  never
> {}

export const GrafanaDatasource = Resource<GrafanaDatasource>('Grafana.Datasource');

/** A named secure-field env var is unset — a domain refusal, not a distilled error. */
export class GrafanaSecretRefUnsetError extends Data.TaggedError('GrafanaSecretRefUnsetError')<{
  readonly message: string;
}> {}

/** Reads every named env var fresh, inside the caller's effect (S24) — never at plan time. */
const resolveSecureJsonData = (
  refs: Record<string, string> | undefined,
): Effect.Effect<Record<string, string> | undefined, GrafanaSecretRefUnsetError> =>
  Effect.gen(function* () {
    if (refs === undefined) return undefined;
    const out: Record<string, string> = {};
    for (const [field, envVar] of Object.entries(refs)) {
      const raw = process.env[envVar];
      if (raw === undefined || raw.trim() === '') {
        return yield* Effect.fail(
          new GrafanaSecretRefUnsetError({
            message:
              `${envVar} is unset. Export the value of secureJsonData.${field} there — ` +
              'never as an Alchemy prop.',
          }),
        );
      }
      out[field] = raw.trim();
    }
    return out;
  });

/** `exactOptionalPropertyTypes` means an undeclared field must be OMITTED, never sent as `undefined`. */
const fields = (props: DatasourceProps) => ({
  name: props.name,
  type: props.type,
  ...(props.access === undefined ? {} : { access: props.access }),
  ...(props.basicAuth === undefined ? {} : { basicAuth: props.basicAuth }),
  ...(props.basicAuthUser === undefined ? {} : { basicAuthUser: props.basicAuthUser }),
  ...(props.database === undefined ? {} : { database: props.database }),
  ...(props.isDefault === undefined ? {} : { isDefault: props.isDefault }),
  ...(props.jsonData === undefined ? {} : { jsonData: props.jsonData }),
  ...(props.url === undefined ? {} : { url: props.url }),
  ...(props.user === undefined ? {} : { user: props.user }),
  ...(props.withCredentials === undefined ? {} : { withCredentials: props.withCredentials }),
});

export const spec: GrafanaSpec<
  DatasourceProps,
  grafana.DataSource,
  DatasourceAttributes,
  | grafana.AddDataSourceError
  | grafana.GetDataSourceByUIDError
  | grafana.UpdateDataSourceByUIDError
  | grafana.DeleteDataSourceByUIDError
  | GrafanaSecretRefUnsetError
> = {
  attributes: (live) => ({
    access: live.access ?? '',
    id: live.id ?? 0,
    isDefault: live.isDefault ?? false,
    name: live.name ?? '',
    orgId: live.orgId ?? 0,
    readOnly: live.readOnly ?? false,
    type: live.type ?? '',
    uid: live.uid ?? '',
    url: live.url ?? '',
    version: live.version ?? 0,
  }),
  create: (props) =>
    Effect.flatMap(resolveSecureJsonData(props.secureJsonDataRefs), (secureJsonData) =>
      grafana.addDataSource({
        ...fields(props),
        ...(secureJsonData === undefined ? {} : { secureJsonData }),
        uid: props.uid,
      }),
    ),
  destroy: (props) => grafana.deleteDataSourceByUID({ uid: props.uid }),
  fetchLive: (props) =>
    grafana
      .getDataSourceByUID({ uid: props.uid })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  /**
   * ⛔ AN UNDECLARED FIELD IS NEITHER COMPARED NOR SENT — the same rule every family in this
   *   estate follows. `secureJsonDataRefs` is never compared: Grafana never returns the value to
   *   diff against, only whether a field is set (`secureJsonFields`), so this resource cannot
   *   detect drift in a secret's value — only in whether one is configured at all.
   */
  matches: (attributes, props) =>
    (props.name === undefined || attributes.name === props.name) &&
    (props.type === undefined || attributes.type === props.type) &&
    (props.url === undefined || attributes.url === props.url) &&
    (props.access === undefined || attributes.access === props.access) &&
    (props.isDefault === undefined || attributes.isDefault === props.isDefault),
  update: (props, live) =>
    Effect.flatMap(resolveSecureJsonData(props.secureJsonDataRefs), (secureJsonData) =>
      grafana.updateDataSourceByUID({
        ...fields(props),
        ...(secureJsonData === undefined ? {} : { secureJsonData }),
        ...(live.version === undefined ? {} : { version: live.version }),
        uid: props.uid,
      }),
    ),
};

export const handlers = grafanaHandlers(spec);

export const GrafanaDatasourceProvider = () =>
  Provider.effect(GrafanaDatasource, Effect.succeed(GrafanaDatasource.Provider.of(handlers)));
