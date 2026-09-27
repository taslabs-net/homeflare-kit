# PVE notification SDK migration

PVE 9.2.11 notification targets and matchers use named distilled SDK operations
for every lifecycle call. Their existing declaration forms, comparison rules,
secret omission and vendor constraint guards remain in place.

A missing matcher or target returns HTTP 404, confirmed by read-only probes on
2026-09-24. The provider catches the SDK's typed `NotFound` for absent reads and
idempotent deletes. Authentication, permissions, transport failures and unrelated
server errors propagate. A malformed successful read fails against the SDK's
response schema; diagnostics do not retain response contents.

SDK request schemas validate the form-name translation before sending a write.
Arrays use repeated form keys. Commas within matcher rules and webhook property
strings remain part of each item. An explicitly empty recipient/header list uses
the vendor's update `delete` field, because an empty SDK array emits no keys.
Undeclared fields remain unmanaged.

A matching adoption sends no write. A changed name replaces the resource; an
endpoint changing type under the same name replaces delete-first because the
name is unique across types. Built-in deletion still reverts the vendor default,
and a gotify create still refuses its missing write-only token: this migration
does not introduce secrets into persisted props.

`notification-distilled.test.ts` exercises create, matching adoption, list clearing,
identity replacement, malformed/refused reads and subsequent no-op plans through
the upstream Alchemy harness and real SDK protocol. Live verification follows the
published release in the consuming stack; fixtures do not prove live writes.
