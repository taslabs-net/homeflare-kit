# @homeflare/distilled-grafana

## 0.2.0

### Minor Changes

- [#234](https://github.com/taslabs-net/homeflare-kit/pull/234) [`3357caa`](https://github.com/taslabs-net/homeflare-kit/commit/3357caa7c9a412365d3959bbb306628329eba4f8) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `@homeflare/distilled-grafana`, an unmodified copy of the (not yet
  upstream-published) `@distilled.cloud/grafana` SDK — 282 operations across
  one service module, generated from Grafana's own committed OpenAPI 3.0.3
  document (`grafana/grafana@main`, mirror commit `38c18a03`).

  32 of those 282 are new relative to the published `1.0.0-rc.12` tarball:
  folder CRUD (`createFolder`/`getFolderByUID`/`updateFolder`/`deleteFolder`/
  `getFolders`), plain dashboard CRUD (`postDashboard`/`getDashboardByUID`/
  `deleteDashboardByUID`), and alerting provisioning writes (alert rules, rule
  groups, contact points, notification policies, mute timings, templates).
  Grafana's spec marks the whole classic write surface `deprecated: true`,
  pointing at a separate Kubernetes-apiserver route this spec doesn't
  describe at all, so the distilled clone's `skipDeprecated: true` default
  dropped them; RFC-6902 patches un-deprecate exactly these 32 (the other 32
  deprecated operations — playlists, org/user preferences,
  datasources-by-name, licensing, reports, dashboard stars/tags/versions —
  stay excluded, unchanged). A new `PreconditionFailed` (412) error class
  covers the dashboard `version`-conflict response; alerting's write
  operations carry the `X-Disable-Provenance` header input. See
  `packages/alchemy/docs/grafana.md` for the full measurement.

  This establishes no new route (the kit's interim-package route already
  exists — see `packages/alchemy/docs/distilled-interim.md`, established by
  `@homeflare/distilled-netbox`). `Grafana.Datasource`'s operations
  (`addDataSource`/`getDataSourceByUID`/`updateDataSourceByUID`/
  `deleteDataSourceByUID`) were never deprecated and are byte-identical to
  `1.0.0-rc.12`'s.
