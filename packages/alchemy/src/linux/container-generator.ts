/**
 * Quadlet is a systemd GENERATOR (`systemd.generator(7)`, tag `v257`, `man/systemd.generator.xml`,
 * read 2026-09-24), not a unit reader — this is the one fact the whole lifecycle is built around.
 *
 * ★ "Generator output is supposed to last only until the next `daemon-reload`... Units written by
 *   generators are removed when the configuration is reloaded" (same doc). `daemon-reload` DELETES
 *   `/run/systemd/generator` wholesale and reruns every generator from the `.container` files
 *   currently on disk. So a `.container` file the generator refuses produces NO generated unit —
 *   even one that generated fine a moment ago, if `daemon-reload` runs again over a now-broken file.
 *   That is why `container-lifecycle.ts` restores the LAST-KNOWN-GOOD file and reloads again on a
 *   failed update, rather than leaving the bad file in place the way `Systemd.Unit` leaves a bad
 *   update for the next deploy to retry (unit-lifecycle.ts): here, "the next deploy" might be a
 *   reboot, and by then the container this resource already promised running has no systemd unit
 *   at all, not merely a stale one.
 * ⛔ THE GENERATED UNIT CANNOT BE `systemctl enable`D — `podman-systemd.unit(5)`, Podman 5.4, "Podman
 *   unit files": "The services created by Podman are considered transient by systemd... it is not
 *   possible to 'systemctl enable' them... To compensate... the generator manually applies the
 *   [Install] section... during generation, in the same way `systemctl enable` does when run
 *   later." MEASURED on CT100 2026-09-24 (`ssh ct100`, read-only): `caddy.container` declares
 *   `[Install] WantedBy=multi-user.target` and nothing ever ran `systemctl enable caddy`; yet
 *   `systemctl is-enabled caddy.service` prints `generated`, `UnitFileState=generated`, and
 *   `/run/systemd/generator/multi-user.target.wants/caddy.service` is a symlink the GENERATOR put
 *   there. So `Podman.Container` has no `enabled` prop and never calls `enableUnit`/`disableUnit`
 *   (systemctl.ts) — declaring `install.wantedBy` IS the enablement, applied by the generator on
 *   every `daemon-reload`, exactly the way `Systemd.Unit`'s enable/disable calls are applied by
 *   this family's own `settle` step. That is the one place this family's "enable logic" differs.
 * ★ SourcePath TIES THE GENERATED UNIT BACK TO OUR FILE. MEASURED on CT100 2026-09-24:
 *   `systemctl show caddy.service -p SourcePath` -> `/etc/containers/systemd/caddy.container`.
 *   `verifyGenerated` below uses it the way `unit-preflight.ts`'s `assertUnclaimed` uses a file
 *   digest: a generated unit whose SourcePath is NOT our path belongs to a same-named `.container`
 *   file earlier in `QUADLET_SEARCH_DIRECTORIES` (container-form.ts) — a takeover, not a success.
 * ⚠️ REASONED, NOT MEASURED — THE ONE GAP THIS VERIFICATION HAS: whether an ALREADY-ACTIVE unit's
 *   `LoadState` stays `loaded` (systemd does not garbage-collect a referenced/active unit object
 *   merely because a reload failed to reproduce it) even when the UPDATED `.container` file the
 *   generator just refused would, on its own, generate nothing. Measuring this needs writing a
 *   broken file to a live host, which read-only access forbids. If that is how a live host
 *   behaves, `LoadState`/`SourcePath` alone would not catch a failed update to a container that
 *   was already running — only a CREATE, or an update to an already-INACTIVE one, is verified with
 *   full confidence by this check alone. Restoring the last-known-good file on ANY verification
 *   failure (container-lifecycle.ts) does not depend on this gap: it always leaves the host at the
 *   file that is known to generate, closing the risk window even where detection is uncertain.
 * ⛔ `needsVerificationReload` (below) is what stops a NEW resource from getting stuck — found on
 *   adversarial review. `container-lifecycle.ts`'s `needsReload` used to be `wrote || stale ||
 *   preStatus.needDaemonReload`; for an INTERRUPTED CREATE (the write landed, the apply crashed
 *   before `daemon-reload` ran) the retry sees `wrote: false` (the file already holds `desired`)
 *   and `stale: false` (there is no PRIOR state to disagree with — this is a create), so nothing
 *   ever reloaded and `verifyGenerated` threw on the still-missing generated unit, forever: loud,
 *   but stuck, since nothing about a plain retry ever changed. The same holds for adopting a file
 *   whose generated unit is missing or does not match. `needsVerificationReload` shares
 *   `generatedMatches` with `verifyGenerated` itself, so the reload gate and the verification it
 *   is gating can never disagree about what "already proven" means.
 */
import type { UnitStatus } from './systemctl.ts';

/** MEASURED on CT100 2026-09-24: `systemctl show caddy.service -p FragmentPath`. */
export const GENERATED_UNIT_DIRECTORY = '/run/systemd/generator';

/**
 * Whether `fragmentPath` is Quadlet's OWN generator output — the "did daemon-reload actually
 * produce OUR unit" question `verifyGenerated` needs, as distinct from `isShadowingFragment`
 * below (the "does something ELSE outrank the generator" question `assertUnshadowed` needs — the
 * two are not complements of each other, see that function's header).
 */
export const isGeneratorFragment = (fragmentPath: string | undefined): boolean =>
  fragmentPath !== undefined && fragmentPath.startsWith(`${GENERATED_UNIT_DIRECTORY}/`);

/**
 * ⛔ CORRECTED ON ADVERSARIAL RE-REVIEW OF THE FIX BELOW — the directories that ACTUALLY search
 *   BEFORE `${GENERATED_UNIT_DIRECTORY}` in systemd's real Unit File Load Path (`systemd.unit(5)`,
 *   tag v257, "Unit File Load Path"), highest to lowest precedence:
 *     /etc/systemd/system.control, /run/systemd/system.control, /run/systemd/transient,
 *     /etc/systemd/system, /etc/systemd/system.attached, /run/systemd/system,
 *     /run/systemd/system.attached, [${GENERATED_UNIT_DIRECTORY}], /usr/local/lib/systemd/system,
 *     /usr/lib/systemd/system, /run/systemd/generator.late.
 * ⛔ `/usr/local/lib/systemd/system` AND `/usr/lib/systemd/system` ARE DELIBERATELY ABSENT — the
 *   original version of this check (`isGeneratorFragment`'s NEGATION: "not the generator's own
 *   output") treated ANY other FragmentPath as shadowing, including these two vendor directories,
 *   which are LOWER precedence than the generator, not higher. A plain unit there is harmlessly
 *   shadowed BY Quadlet's generated unit, same as `unit-form.ts`'s `UNIT_SEARCH_DIRECTORIES`
 *   (measured via `systemd-analyze unit-paths`) independently lists them below `/run/systemd/system`,
 *   and `systemctl.ts`'s own header distinguishes `/etc/systemd/system` from "the vendor's
 *   `/usr/lib/systemd/system`" rather than lumping the two together. Refusing for either one blocked
 *   a create/adopt apply would have handled fine — exactly the false positive S49 ("neither looser
 *   nor stricter") forbids. `/etc/systemd/system.control`, `.attached` and `/run/systemd/transient`
 *   are included for completeness against the man page though no family here writes into them.
 */
const SHADOWING_UNIT_DIRECTORIES = [
  '/etc/systemd/system.control',
  '/run/systemd/system.control',
  '/run/systemd/transient',
  '/etc/systemd/system',
  '/etc/systemd/system.attached',
  '/run/systemd/system',
  '/run/systemd/system.attached',
] as const;

/**
 * Whether `fragmentPath` genuinely OUTRANKS Quadlet's generator — the real question
 * `container-preflight.ts`'s `assertUnshadowed` needs ("would writing our `.container` file and
 * reloading still lose to this other unit?"), as opposed to the broader and wrong question the
 * original check asked ("is this simply not the generator's own output?", which is also true of
 * every LOWER-precedence vendor unit and wrongly refused those too).
 */
export const isShadowingFragment = (fragmentPath: string | undefined): boolean =>
  fragmentPath !== undefined &&
  SHADOWING_UNIT_DIRECTORIES.some((dir) => fragmentPath.startsWith(`${dir}/`));

export class QuadletGeneratorError extends Error {
  constructor(name: string, detail: string) {
    super(`Podman.Container ${name}: ${detail}`);
    this.name = 'QuadletGeneratorError';
  }
}

/** Whether `status` already proves a generated unit that came from `containerPath` — the one
 *  question both `verifyGenerated` (throws when false) and `needsVerificationReload` (reloads to
 *  try to make it true) ask. */
const generatedMatches = (containerPath: string, status: UnitStatus): boolean =>
  status.known &&
  status.loadState === 'loaded' &&
  (status.sourcePath === undefined || status.sourcePath === containerPath);

/**
 * Whether `container-lifecycle.ts` must `daemon-reload` before trusting `status` as proof of
 * anything — true whenever `status` does not already show a matching generation. Called on the
 * PRE-write status, so it costs nothing when `wrote`/`stale`/`NeedDaemonReload` already force a
 * reload; it earns its keep exactly when none of them do but nothing has actually been proven yet
 * (a fresh create or adopt with no prior state to compare against).
 */
export const needsVerificationReload = (containerPath: string, status: UnitStatus): boolean =>
  !generatedMatches(containerPath, status);

/**
 * Throws a typed, loud `QuadletGeneratorError` — never lets a generator failure read as "the
 * resource is simply absent", which is what a plain `LoadState=not-found` would otherwise look
 * like to a caller that only knows the `Systemd.Unit` shape (a unit that has genuinely never been
 * declared also reads `not-found`).
 *
 * ⛔ THE FRAGMENTPATH CHECK BELOW WAS ADDED — found on adversarial review of `assertUnshadowed`
 *   (container-preflight.ts): before it, this function trusted `LoadState`/`SourcePath` alone, and
 *   neither one notices a genuinely-shadowing PLAIN unit. A real, already-loaded plain unit (e.g.
 *   an admin's own `/etc/systemd/system/foo.service` sharing this container's service name) reports
 *   `LoadState=loaded` — it is a valid unit — and `SourcePath` empty, since hand-written units never
 *   carry one; both checks above pass it silently. MEASURED directly against this function: a
 *   `status` built from exactly what `systemctl show` reports for that case (`loadState: 'loaded'`,
 *   `fragmentPath` under `/etc/systemd/system`, `sourcePath: undefined`) did not throw before this
 *   check existed. Without it, `assertUnshadowed`'s plan-time refusal was the ONLY thing standing
 *   between a shadowing plain unit and a SILENT apply-time "success" that leaves the pre-existing
 *   unit running untouched while state records attributes read back from it — not a loud mid-apply
 *   throw, which is what earlier documentation of this fix claimed the pre-fix risk was.
 */
export const verifyGenerated = (
  name: string,
  containerPath: string,
  serviceName: string,
  status: UnitStatus,
): void => {
  if (!status.known || status.loadState !== 'loaded') {
    throw new QuadletGeneratorError(
      name,
      `${serviceName} does not exist after daemon-reload (LoadState=${status.loadState}). The ` +
        '.container file was written and reloaded, so Quadlet’s generator refused it — a bad ' +
        'key, a bad value, or an interaction this validation does not check. Debug on the host ' +
        "with '/usr/lib/systemd/system-generators/podman-system-generator --dryrun' or " +
        `'systemd-analyze --generators=true verify ${serviceName}' (podman-systemd.unit(5), Podman 5.4).`,
    );
  }
  if (status.fragmentPath !== undefined && !isGeneratorFragment(status.fragmentPath)) {
    throw new QuadletGeneratorError(
      name,
      `${serviceName} is loaded from ${status.fragmentPath}, not from Quadlet’s generator ` +
        `(${GENERATED_UNIT_DIRECTORY}/…) — daemon-reload ran, but a plain unit at that path still ` +
        'answers to this name, and systemd loaded IT, not ours. Move the plain unit aside — a ' +
        'cutover — and redeploy.',
    );
  }
  if (status.sourcePath !== undefined && status.sourcePath !== containerPath) {
    throw new QuadletGeneratorError(
      name,
      `${serviceName}'s SourcePath is ${status.sourcePath}, not ${containerPath} — a same-named ` +
        '.container file earlier in Quadlet’s search path is generating this unit instead of ours ' +
        '(podman-systemd.unit(5) “Podman Unit Search Path”, Podman 5.4).',
    );
  }
};
