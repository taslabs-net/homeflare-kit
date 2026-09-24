---
'@homeflare/alchemy': minor
---

New family: `@homeflare/alchemy/grafana`. `Grafana.Datasource` declares one data source, keyed by
`uid`, calling `@distilled.cloud/grafana`'s typed `addDataSource`/`getDataSourceByUID`/
`updateDataSourceByUID`/`deleteDataSourceByUID` operations, `catchTag('NotFound', ...)` in place of
a status check. Credentials are a `GrafanaTarget` (instance origin + a token env var NAME, never a
literal value) resolved lazily per call, parameterized per instance rather than fixed like
Forgejo's — this estate runs more than one Grafana. `grafanaProviders(target)` composes the
provider with its credentials, mirroring `litellmProviders`.

Only `Datasource` ships: `@distilled.cloud/grafana@1.0.0-rc.12` has no create/update/delete
operations for folders, dashboards, alert rules or contact points, measured against its published
types — recorded in `docs/grafana.md` and `docs/upstream-conformance.md` rather than worked
around with a hand-rolled client for the missing pieces.

Built and measured, read-only, against the live target `teslamate-grafana.service` on CT100
(Grafana 13.1.3, `teslamate/grafana:4.2.0`): one file-provisioned datasource, image-baked
dashboards, no folders, alert rules or contact points. No stack yet imports this subpath.
