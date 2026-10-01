---
'@homeflare/alchemy': patch
---

Fix Postgres.Schema takeover and identity checks, walked against PostgreSQL 18.6
(REL_18_6). Existing schemas without persisted output and duplicate-create races now
require explicit adoption, including crash recovery. Refuse recycled oids and repeat
name/database change refusals during apply when unresolved Outputs skipped planning.

Escape SQL string literals safely under either standard_conforming_strings setting,
including Schema comments, Database options, Role literals and psql-bound parameters.
Preserve Role password redaction for escape literals. Correct the schema fake's
PostgreSQL semantics and isolate socket tests with an Effect-scoped pool factory.
