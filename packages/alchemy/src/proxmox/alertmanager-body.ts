/**
 * A PBS webhook body that posts one Alertmanager v2 alert — `POST /api/v2/alerts` takes a JSON
 * ARRAY of `postableAlert`, each with a required `labels` map and an optional `annotations` map,
 * every value a string (Alertmanager's api/v2/openapi.yaml, read at main 2026-09-22).
 *
 * ★ PURE TEXT, NOT A RENDERER. PBS renders it, with Handlebars, at send time: `{{ severity }}`,
 *   `{{ title }}`, `{{ message }}`, `{{ timestamp }}` and `{{ fields.<name> }}` are the
 *   notification, and `json`, `escape` and `url-encode` are the only helpers
 *   (proxmox-notify endpoints/webhook.rs `setup_handlebars`, read at HEAD 2026-09-22).
 *
 * ⛔ THERE IS NO ESCAPING UNLESS THE TEMPLATE ASKS FOR IT. The webhook's Handlebars registers
 *   `no_escape` ("There is no escape."), so `"{{ message }}"` breaks the JSON the first time a
 *   task log holds a quote or a newline — and a failed job's message is exactly a task log. Every
 *   value below goes through `json`, which emits a complete, quoted JSON string.
 * ⛔ A FIELD THE NOTIFICATION DOES NOT CARRY MUST NOT BE REACHED FOR BARE. `escape` on a missing
 *   field fails the whole render, and the notification is then lost — not degraded. MEASURED
 *   (2026-09-22) with handlebars-rust 5.1.2 and the webhook's three helpers restated from source:
 *   `{{ escape fields.job-id }}` over no fields errors "param at index 0 required but not found";
 *   `{{ json fields.job-id }}` renders `null`, valid JSON but not a label value. Garbage
 *   collection has no `job-id`, and the UI's "Test" button sends a notification with NO fields at
 *   all (lib.rs `test_target`). So every field-derived label sits inside
 *   `{{#if}}`, ends with its own comma, and the labels after them are always there: whichever
 *   fields are present, the object stays valid JSON.
 *
 * ⚠️ ALERTMANAGER RESOLVES IT BY ITSELF. With no `endsAt` it sets `now + resolve_timeout` (5m by
 *   default, api/v2/api.go `postAlertsHandler`), and PBS never sends a resolve — so a receiver
 *   with `send_resolved: true` reports "resolved" five minutes after a failure that nobody fixed.
 *   Page on the firing notification; do not read the resolve as a recovery.
 * ⚠️ `severity` IS PBS'S WORD, not Alertmanager convention: `info`, `notice`, `warning`, `error`,
 *   `unknown`. Route on `severity="error"`, or relabel it in the Alertmanager config.
 */

export interface AlertmanagerBodyOptions {
  /** The `alertname` label. Default `PbsNotification`; `job_type` says which job it was. */
  readonly alertname?: string;
  /** The `source` label. Default `pbs`. */
  readonly source?: string;
  /** Optional `generatorURL` — an absolute link back to the PBS UI. */
  readonly generatorURL?: string;
}

/**
 * ⛔ AN OPTION IS PASTED INTO THE TEMPLATE, SO IT MAY NOT CARRY TEMPLATE SYNTAX. A `{{` in an
 *   alert name would be rendered by PBS as an expression; a brace or backslash is refused here
 *   rather than escaped, because Handlebars' escape rules are the renderer's, not this file's.
 */
const literal = (label: string, value: string): string => {
  if (/[{}\\]/.test(value) || value === '') {
    throw new Error(
      `alertmanagerAlertBody: ${label} must be non-empty and hold no '{', '}' or '\\'`,
    );
  }
  return JSON.stringify(value);
};

/**
 * ⛔ AN ABSOLUTE http(s) URL OR NOTHING. Alertmanager validates `generatorURL` as `format: uri`
 *   (api/v2/openapi.yaml) and answers 422 for the WHOLE post — so a typo here would not degrade
 *   one field, it would lose every notification, and only at send time.
 */
const absoluteUrl = (value: string): string => {
  const text = literal('generatorURL', value);
  let protocol = '';
  try {
    protocol = new URL(value).protocol;
  } catch {
    // not a URL at all: refused below, like a relative one
  }
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error('alertmanagerAlertBody: generatorURL must be an absolute http(s) URL');
  }
  return text;
};

/** Label name → notification field. ⚠️ Label names must match `[a-zA-Z_][a-zA-Z0-9_]*`. */
const FIELD_LABELS: readonly (readonly [label: string, field: string])[] = [
  ['job_type', 'type'],
  ['job_id', 'job-id'],
  ['datastore', 'datastore'],
  ['hostname', 'hostname'],
];

/**
 * The body template. Declare it on a webhook target together with `Content-Type:
 * application/json`, method `post`, and the URL `<alertmanager>/api/v2/alerts`.
 *
 * ★ `fields.job-id` IS A VALID PATH: Handlebars-rust 5 (the version proxmox-notify pins) allows
 *   `-` in an identifier (grammar.pest `symbol_char`), as handlebars.js does. The same scratch
 *   build rendered this template for a GC failure, a verify failure and a field-less test
 *   notification, and each parsed as JSON with string-only labels. The adversarial review re-ran
 *   it over the test file's whole matrix — every PBS event's fields x five severities x hostile
 *   text, 840 renders with and without `generatorURL` — and every one parsed (2026-09-22).
 * ⚠️ THAT BUILD IS NOT PBS. The first real notification is the measurement that counts: send one
 *   with the target's "Test" button and read what Alertmanager received.
 */
export const alertmanagerAlertBody = (options: AlertmanagerBodyOptions = {}): string => {
  const alertname = literal('alertname', options.alertname ?? 'PbsNotification');
  const source = literal('source', options.source ?? 'pbs');
  const labels = FIELD_LABELS.map(
    ([label, field]) =>
      `      {{#if fields.${field}}}"${label}": {{ json fields.${field} }},{{/if}}`,
  );
  const link =
    options.generatorURL === undefined
      ? ''
      : `,\n    "generatorURL": ${absoluteUrl(options.generatorURL)}`;
  return [
    '[',
    '  {',
    '    "labels": {',
    ...labels,
    '      "severity": {{ json severity }},',
    `      "alertname": ${alertname},`,
    `      "source": ${source}`,
    '    },',
    '    "annotations": {',
    '      "summary": {{ json title }},',
    '      "description": {{ json message }},',
    '      "timestamp": "{{ timestamp }}"',
    `    }${link}`,
    '  }',
    ']',
    '',
  ].join('\n');
};
