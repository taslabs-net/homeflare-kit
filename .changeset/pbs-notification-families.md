---
'@homeflare/alchemy': minor
---

Proxmox notifications that page. `@homeflare/alchemy/proxmox` adds three adopt-capable families and
a webhook body:

- **`PbsNotificationTarget`** — PBS `webhook`, `smtp` and `sendmail` targets. Secret fields are
  **write-only**: a webhook `secret`, the smtp `password` and any credential-bearing `header` are
  declared as `{ fromEnv: 'VARIABLE' }` and read by the deploying process at call time. No value
  reaches Alchemy state — the store keeps names, a fixed-salt scrypt digest of the live headers, and
  a random-salt seal of what the provider last wrote. A plan diffs on those (hash or presence), a
  plan without the variables is presence-only, a rotated value is PUT alone, and a write that needs
  a missing variable fails by the variable's name before any request.
- **`PbsNotificationMatcher`** and **`ProxmoxNotificationMatcher`** — `match-severity`,
  `match-field`, `match-calendar`, `targets`, `mode`, `invert-match`, `comment`, `disable`. A matcher
  is compared as its whole rule; both built-in `default-matcher`s adopt as-is with no write.
- **`alertmanagerAlertBody()`** — a PBS webhook body template that posts one Alertmanager v2 alert
  (`/api/v2/alerts`; labels `alertname`, `severity`, `source`, `job_type`, `job_id`, `datastore`,
  `hostname`; annotations `summary`, `description`). Every value goes through `json`, and every
  optional field is guarded, so a GC failure (no `job-id`) and the UI's field-less Test notification
  both render valid JSON.
- `FromEnv` is exported. The PVE and PBS generated API types now cover the notification endpoints
  and matchers, and the shared PVE read treats a `{"data": null}` answer as absent instead of
  throwing.

Guide: `docs/pbs-notifications.md`.
