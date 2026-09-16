/**
 * A verification job's props as the form PBS wants, and the one derived string worth reporting.
 *
 * ★ SPLIT OUT OF pbs-verify-job.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, on the seam
 *   replication-job-form.ts and ha-rule-form.ts already cut: this file answers "how does a
 *   declaration become a PBS write, and what do the two filter fields actually mean", and
 *   pbs-verify-job.ts answers "what is a verification job and when has it changed". Nothing here
 *   reads the host and nothing here decides a diff.
 *
 * ⚠️ THE `import type` BACK TO pbs-verify-job.ts IS A CYCLE ON PAPER ONLY — type-only, erased
 *   before anything runs, and `PbsVerifyJobProps` stays public in the file declaring the resource.
 *
 * ⛔ THERE IS NO `disable` FIELD ON A PBS VERIFICATION JOB, AND SHIPPING A PROP FOR ONE WOULD HAVE
 *   BEEN THE WORST BUG IN THIS FAMILY. Prune jobs have `disable` and sync jobs have `disable`;
 *   `VerificationJobConfig` does not, in the struct, in the API schema, or in the update handler's
 *   `DeletableProperty` enum — read at HEAD of pbs-api-types and src/api2/config/verify.rs on
 *   2026-09-13. A `disable` prop would therefore be a prop that either does nothing or 400s the
 *   whole call (the create schema has `additional_properties: false`, so an unknown key is
 *   rejected with "schema does not allow additional properties"). Either way it would be a
 *   declaration saying "verification is paused" that PBS never agreed to. The real off switch is
 *   an absent `schedule`.
 *   ★ NOW VERIFIED AGAINST THE RUNNING HOST, which this comment previously said it was not.
 *     `proxmox-backup-manager verify-job update --help` on the live 4.2 server offers
 *     `--comment --delete --digest --ignore-verified --max-depth --ns --outdated-after
 *     --read-threads --schedule --store --verify-threads` — no `--disable` — and its `--delete`
 *     enum contains `schedule`. Both halves of the claim hold on this estate's actual version.
 *   ⚠️ `read-threads` AND `verify-threads` EXIST ON 4.2 AND ARE NOT PROPS HERE. Nothing on this
 *     estate sets either, and a prop nobody uses is an abstraction with no user — the same reason
 *     `PveSpec.immutable` was backed out. Add them when something needs them.
 *
 * ⛔ `withClears` FROM values.ts IS DELIBERATELY NOT USED HERE, AND USING IT WOULD BREAK EVERY
 *   UPDATE. PVE's `delete` is ONE comma-separated string; PBS's is an ARRAY of an enum. MEASURED in
 *   proxmox-schema's `do_parse_parameter_strings`: for an `Schema::Array` property each occurrence
 *   of the key pushes ONE element, so a form body must REPEAT the key — `delete=ns&delete=comment`.
 *   `withClears` emits `delete: 'ns,comment'`, which PBS parses as a single element `"ns,comment"`,
 *   which is not a `DeletableProperty` variant, so the call fails with a parameter error. It fails
 *   loudly rather than quietly, which is the only good news in it.
 *   ★ AND IT COULD NOT BE FIXED IN THIS FILE ANYWAY. `client.ts` types a form as
 *     `Record<string, string>` and builds it with `new URLSearchParams(form)`; neither a plain
 *     object nor that constructor overload can express a repeated key. Clearing a PBS field needs
 *     a client that takes entry pairs. Until one exists, this form SETS and never CLEARS — so an
 *     undeclared field is left alone and, in pbs-verify-job.ts, is not compared either.
 */
import type { PbsVerifyJobProps } from './pbs-verify-job.ts';

/**
 * What the live pair actually causes, rendered for a plan line.
 *
 * ⛔ THE DEFAULTS MEAN "VERIFY EACH SNAPSHOT EXACTLY ONCE, EVER", AND THAT IS THE FAILURE THIS
 *   WHOLE FAMILY EXISTS TO MAKE VISIBLE. Read from src/backup/verify.rs `verify_filter` and
 *   src/server/verify_job.rs at HEAD on 2026-09-13, the filter is:
 *
 *     ignore_verified = ignore_verified.unwrap_or(true)      // absent means TRUE
 *     if !ignore_verified                       -> verify
 *     manifest has no verify state              -> verify
 *     outdated_after is None                    -> SKIP, forever
 *     days_since_last_verify > outdated_after   -> verify
 *
 *   So a job created with neither field set — the shape the PBS web UI produces when nobody
 *   touches those two boxes — checks every snapshot once on the run after it is written and then
 *   never looks at it again. Bit rot that appears a month later is never found. The job stays
 *   green the entire time, because a job that verified nothing verified nothing badly.
 *
 * ⚠️ A FAILED PAST VERIFICATION IS SKIPPED TOO. `verify_filter` looks only at whether a verify
 *   state EXISTS, never at whether it says Ok or Failed, so a snapshot that failed once is not
 *   re-checked by a defaulted job either. Pair that with a prune job and the failure ages out
 *   without anyone confirming it.
 *
 * ⛔ `outdated-after: 0` DOES NOT MEAN "NEVER", THOUGH PBS'S OWN STRUCT DOC SAYS IT DOES. That
 *   comment — "Reverify snapshots after X days, never if 0" — contradicts the code beside it: the
 *   test is `days_since_last_verify > max_age`, so `0` re-verifies everything checked more than a
 *   day ago, i.e. very nearly every run. The schema text calls `0` deprecated and the minimum is
 *   `0`, so it is accepted. "Never" is the ABSENT value, not the zero — and this resource cannot
 *   get a job back to absent (see the ⛔ on `withClears` above), so a declaration that sets
 *   `outdated-after` has made a one-way choice. Undo it by hand:
 *   `proxmox-backup-manager verify-job update <id> --delete outdated-after`.
 *
 * ⚠️ THE COMPARISON IS INTEGER DAYS SINCE THE LAST RUN'S START, `(now - upid.starttime) / 86400`,
 *   and it is strictly greater-than. `outdated-after: 30` therefore re-checks on day 31.
 */
export const rechecks = (ignoreVerified: boolean, outdatedAfter: number): string => {
  if (!ignoreVerified) return 'every snapshot on every run';
  // ⚠️ `-1` is this package's spelling of "the key is absent", set in `attributes`. It is not a
  //   value PBS accepts: the schema's minimum is 0.
  if (outdatedAfter < 0) return 'never: each snapshot is checked once and then skipped forever';
  return `once the last check is more than ${String(outdatedAfter)} day(s) old`;
};

/**
 * The form for create and update alike.
 *
 * ⛔ `schedule: null` OMITS THE KEY, AND ON AN UPDATE THAT DOES NOT CLEAR AN EXISTING ONE. This
 *   form SETS and never CLEARS — the ⛔ on `withClears` above is why — so declaring `null` against
 *   a job that already has a schedule plans an update that changes nothing, every time. Park a job
 *   by hand once and the declaration then describes it truthfully:
 *   `proxmox-backup-manager verify-job update <id> --delete schedule`. The honest failure is a
 *   plan that keeps asking; the dishonest one would be a form that quietly reported success.
 *
 * ⚠️ `store` AND `ignore-verified` ARE ALWAYS SENT BECAUSE THEY ARE ALWAYS COMPARED.
 *   A field compared against a default but not sent as that default is an update reported on every
 *   plan that the write never performs — backup-job.ts and replication-job-form.ts both record the
 *   same trade. `ignore-verified` is the only one of the three with a PBS-side default, and it is
 *   TRUE, so an undeclared prop is sent as `1` rather than left out.
 *
 * ⚠️ THE BOOLEAN IS SPELLED INLINE RATHER THAN THROUGH `flag()` FROM values.ts, AND THAT IS A TYPE
 *   FACT RATHER THAN A STYLE ONE. `flag` answers `'1' | '0' | undefined` so that an undeclared
 *   field is dropped; here the field must never be dropped, and the `undefined` in its return type
 *   is not assignable to a `Record<string, string>` form body.
 *
 * ⚠️ PBS ACCEPTS BOTH `application/x-www-form-urlencoded` AND `application/json` AND NOTHING ELSE —
 *   any other content type is rejected outright with "unsupported content type", measured in
 *   proxmox-rest-server's `get_request_parameters`. `client.ts` sends the form encoding whenever a
 *   body is present, so it is already speaking one of the two. Numbers are stringified here for
 *   that reason; PBS parses them back through the integer schema.
 *
 * ⛔ `ns` IS DROPPED WHEN IT IS EMPTY, NOT SENT AS `''`. The empty string IS a legal namespace
 *   value — `BACKUP_NS_RE` is wrapped in `(?:…)?`, so it passes the schema and reaches the update
 *   handler — and the handler then throws it away at `if !ns.is_root()`. Sending it would look like
 *   a write that moves the job to the root namespace and would silently be nothing at all.
 */
export const shape = (props: PbsVerifyJobProps): Record<string, string> => ({
  'ignore-verified': props['ignore-verified'] === false ? '0' : '1',
  store: props.store,
  ...(props.schedule === null ? {} : { schedule: props.schedule }),
  ...(props.comment === undefined ? {} : { comment: props.comment }),
  ...(props['max-depth'] === undefined ? {} : { 'max-depth': String(props['max-depth']) }),
  ...(props.ns === undefined || props.ns === '' ? {} : { ns: props.ns }),
  ...(props['outdated-after'] === undefined
    ? {}
    : { 'outdated-after': String(props['outdated-after']) }),
});
