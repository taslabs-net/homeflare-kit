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
 * Whether `fragmentPath` is Quadlet's OWN generator output, not a hand-written or vendor-packaged
 * unit that merely shares the service name — the one fact `container-preflight.ts`'s
 * `assertUnshadowed` needs to tell "nothing here yet" apart from "something else already answers
 * to this name". Kept here, beside `GENERATED_UNIT_DIRECTORY`, so the two can never drift apart.
 */
export const isGeneratorFragment = (fragmentPath: string | undefined): boolean =>
  fragmentPath !== undefined && fragmentPath.startsWith(`${GENERATED_UNIT_DIRECTORY}/`);

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
  if (status.sourcePath !== undefined && status.sourcePath !== containerPath) {
    throw new QuadletGeneratorError(
      name,
      `${serviceName}'s SourcePath is ${status.sourcePath}, not ${containerPath} — a same-named ` +
        '.container file earlier in Quadlet’s search path is generating this unit instead of ours ' +
        '(podman-systemd.unit(5) “Podman Unit Search Path”, Podman 5.4).',
    );
  }
};
