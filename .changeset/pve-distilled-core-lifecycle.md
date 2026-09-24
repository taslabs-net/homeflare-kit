---
'@homeflare/alchemy': patch
---

Use direct distilled SDK operations for PVE Pool, BackupJob and MetricServer lifecycle calls,
walked against pve-manager 9.2.11. Only typed missing-object errors permit creation or idempotent
deletion; authentication, permission and unrelated server failures propagate. Preserve existing
adoption no-ops, retention normalization, omitted backup settings and metric-server secret fields.
