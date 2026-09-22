# A PBS webhook body that posts an Alertmanager alert

`alertmanagerAlertBody()` ([alertmanager-body.ts](../src/proxmox/alertmanager-body.ts)) is the
body of a PBS webhook target that posts one alert to Alertmanager's `POST /api/v2/alerts`.
Declaring the target and the matcher that routes to it: [pbs-notifications.md](./pbs-notifications.md).

With the default options it returns exactly this text:

```text
[
  {
    "labels": {
      {{#if fields.type}}"job_type": {{ json fields.type }},{{/if}}
      {{#if fields.job-id}}"job_id": {{ json fields.job-id }},{{/if}}
      {{#if fields.datastore}}"datastore": {{ json fields.datastore }},{{/if}}
      {{#if fields.hostname}}"hostname": {{ json fields.hostname }},{{/if}}
      "severity": {{ json severity }},
      "alertname": "PbsNotification",
      "source": "pbs"
    },
    "annotations": {
      "summary": {{ json title }},
      "description": {{ json message }},
      "timestamp": "{{ timestamp }}"
    }
  }
]
```

The fence is `text` on purpose. As a `handlebars` fence the formatter reflowed it into
something the function does not return.

Options: `alertname`, `source` and an optional `generatorURL`. Braces and backslashes are
refused in all three. `generatorURL` must also be an absolute `http` or `https` URL, because
Alertmanager validates it as a URI and rejects the whole post if it is not one.

## Why it is valid JSON for every PBS notification

Each point is from the proxmox-notify, proxmox-backup and Alertmanager source, read 2026-09-22.

- **The webhook renderer has no escaping** (`register_escape_fn(no_escape)`). Every value that
  comes from the notification goes through `json`, which is `serde_json::to_string`. It writes
  a complete, quoted JSON string with quotes, backslashes and control characters escaped. A task
  log with a quote, a tab or a newline stays valid JSON.
- **`escape` on a missing field fails the whole render**, and the notification is lost.
  `json` on a missing field writes `null`, which is valid JSON but not a label value. So every
  `fields.*` label sits inside `{{#if}}` and ends with its own comma, and the constant labels
  close the object. The UI's **Test** button sends a notification with no fields at all.
- **Every field value is a string.** proxmox-notify turns each metadata field into a JSON string
  before rendering. `severity` serialises as `info`, `notice`, `warning`, `error` or `unknown`,
  and `timestamp` is an integer (epoch seconds). Nothing else in the data is rendered.
- **The helpers are `json`, `escape` and `url-encode`, and nothing else.** The mail templates'
  `timestamp` and `duration` helpers are not registered for webhooks, so `timestamp` is sent as
  epoch seconds in an annotation.
- **Alertmanager takes an array** (`postableAlerts`). `labels` is required and must not be empty.
  Every label and annotation value must be a string. It drops empty labels.

`tests/alertmanager-body.test.ts` renders the template with handlebars.js set up the way
proxmox-notify sets up its renderer. It covers the field set of every event type in PBS's
`src/server/notifications/mod.rs`, the Test notification, forwarded system mail, and hostile
strings (quotes, backslashes, control characters, `{{`, U+2028). Each result must parse as an
Alertmanager v2 alert array. A scratch build of handlebars-rust 5.1.2, the major version
proxmox-notify pins, rendered the same cases to valid JSON. The first real notification is
still the check that counts: press **Test** on the target, then read what Alertmanager received.

## What it does not do

- **With no `endsAt`, Alertmanager resolves the alert itself** after `resolve_timeout` (5 min by
  default), and PBS never sends a resolve. Treat a "resolved" notification as a timeout, not a
  recovery.
- **`severity` uses PBS's names.** Route on `severity="error"`, or relabel in Alertmanager.
- **Alertmanager deduplicates by label set.** Two failures of the same job within
  `resolve_timeout` are one alert, not two.
