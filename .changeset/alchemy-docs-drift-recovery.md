---
'@homeflare/alchemy': patch
---

The adopt verifier's guide now says what `alchemy drift` does in alchemy 2.0.0-beta.79. It has no dry run and no `--yes` (its docs page lists one). A non-interactive run prints the repair plan and exits `0` even when something drifted, so it cannot gate a deploy. `--repair` restores the props saved at the last deploy, not what the code declares now. The ownership guide now says that recovering from a wiped state store, or from `alchemy state delete`, needs `--adopt` for every family that follows the ownership rule. Alchemy's documented recovery re-imports owned objects without the flag; the kit departs from that on purpose. The exceptions are a `CaddyConfig` running the declared config and the `pveHandlers` resources.
