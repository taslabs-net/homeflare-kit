---
'@homeflare/alchemy': minor
---

Repair Postgres.Role membership options with grantor-specific REVOKE OPTION FOR RESTRICT
per retained row, preserving membership and refusing dependent grants. Unwanted-row revokes
commit first so a blocked repair cannot roll them back. Dependency and permission refusals
map to PostgresRoleMembershipUnrepaired naming the parent and grantor. Read inherit_option
and revoke INHERIT TRUE on retained rows when inherit:false is declared. The exported
buildRepairMembershipSql helper now requires the grantor and ADMIN, SET or INHERIT option.
Reject non-ASCII passwords with PostgresRolePasswordNonAsciiRefused before writes, keep
read attributes consistent with stored state, and plan updates for privileged catalog flags.
Add SQL tracer and psql runner coverage proving plaintext passwords never reach statement text.

Walked against PostgreSQL 16–18 GRANT/REVOKE and PostgreSQL 16 SCRAM/SASLprep documentation;
option repair was measured once by hand on a throwaway PostgreSQL 17.11 (2026-10-02).
Tests stub the 2BP01 response (and 42501); they do not measure dependent grants live.
The existing provider targets PostgreSQL 18.6.
