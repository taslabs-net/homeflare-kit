---
'@homeflare/alchemy': patch
---

Postgres: pin `search_path = pg_catalog, pg_temp` on every session and schema-qualify every
catalog reference; `Postgres.Schema` delete now proves and drops in one atomic `DO` block under an
advisory lock, and `cascade: true` refuses (typed, count only) when objects in other schemas
depend on the schema.
