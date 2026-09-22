/**
 * Whether an assembled policy would carry NO GRANT — the one write `Bao.Policy` must refuse.
 *
 * ⛔ EMPTY MEANS NO `path` GRANT, NOT NO FILES. Writing `sys/policies/acl/<name>` with nothing in it
 *   SILENTLY REVOKES every grant the policy carries, for every token bound to it. The first guard
 *   only counted fragment files, so a directory whose one fragment was empty, whitespace or
 *   comments — a truncated edit, a bad checkout — assembled to text with no grant in it, passed,
 *   and would have replaced the live policy with nothing. Found by grok's review on 2026-09-14.
 * ★ A GRANT IS A `path "…"` STANZA, the unit apply-agent-policy.sh counts and `grantsOf` in
 *   policy.ts reports. Leading whitespace is allowed here, so an indented stanza still counts.
 */
export const isEmptyAssembly = (parts: number, joined: string): boolean =>
  parts === 0 || !/^\s*path\s+"/m.test(joined);
