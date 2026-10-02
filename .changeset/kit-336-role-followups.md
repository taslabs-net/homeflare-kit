---
'@homeflare/alchemy': patch
---

Repair Postgres.Role membership options with grantor-specific REVOKE OPTION FOR RESTRICT
in one transaction, preserving membership and refusing dependent grants. The exported
buildRepairMembershipSql helper now requires the grantor and ADMIN or SET option.
Reject non-ASCII passwords with PostgresRolePasswordNonAsciiRefused before writes, keep
read attributes consistent with stored state, and plan updates for privileged catalog flags.
Add SQL tracer and psql runner coverage proving plaintext passwords never reach statement text.

Walked against PostgreSQL 16 GRANT/REVOKE and SCRAM/SASLprep documentation; option repair
measured on local PostgreSQL 17.11 (2026-10-02). The existing provider targets PostgreSQL 18.6.
