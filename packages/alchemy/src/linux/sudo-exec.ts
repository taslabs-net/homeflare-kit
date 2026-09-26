/**
 * `sshSudoRunner.exec()`'s root branch: the host reads that decide whether a routed-to-root
 * directory or systemctl call may actually elevate. Split out of sudo-runner.ts, which keeps only
 * the wiring. sudo-allowlist.ts's `routeExec` already decided root vs operator vs refuse from the
 * argv alone; this is the part that needs the host.
 *
 * ⛔ THE FragmentPath CHECK IS WHAT MAKES `pveproxy.service` UNREACHABLE. A vendor unit's file
 *   lives under `/usr/lib/systemd/system` or `/lib/systemd/system` — never a prefix this runner
 *   would declare — so `enable`/`start`/… on it is refused before sudo runs. A unit with NO file
 *   at all (FragmentPath empty) is let through for `stop`/`disable` only, because
 *   `unit-lifecycle.ts` `deleteUnit` calls exactly those two on a unit whose file this same
 *   delete already removed a moment before — refusing that would make a second, idempotent
 *   delete pass fail.
 * 🔴 MEASURED (adversarial review, round 2, 2026-09-23): two gaps in this check, both closed here.
 *   (1) A MASKED unit (`systemctl mask`, a symlink to `/dev/null`) also reads `FragmentPath=`
 *   empty, so `enable`/`start`/`restart` on a masked `pveproxy.service` would have elevated —
 *   `systemctl` itself would then refuse the write, but nothing here should even try; masking is
 *   someone's deliberate decision (`unit-preflight.ts`'s `assertUsable` already refuses it at the
 *   PROVIDER layer, and this is the same rule enforced again at the lowest level, in case a
 *   caller reaches `exec()` directly). (2) The empty-FragmentPath exemption applied to EVERY
 *   write verb, not just the two `deleteUnit` actually needs — so `enable`/`start`/`restart` on a
 *   kernel-generated pseudo-unit with no file at all (`init.scope`, a `session-N.scope`; `.scope`
 *   is a valid type in `unit-form.ts`'s `TYPES` set) would also have elevated. Grepped: no code
 *   in this package ever calls `enable`/`start`/`restart` on a unit it has not itself just
 *   written a file for, so narrowing the exemption to `stop`/`disable` costs nothing legitimate.
 * 🔴 MEASURED, CT100 deploy 2026-09-26 00:11Z: a THIRD gap, this one refusing a call that should
 *   have been allowed. `Podman.Container caddy`'s generated `caddy.service` has
 *   `FragmentPath=/run/systemd/generator/caddy.service` — Quadlet's generator output, never a
 *   path this runner would ever declare as a prefix (nothing writes there directly) — so `restart`
 *   was refused outright, even though the `.container` FILE THAT GENERATED IT lives at
 *   `/etc/containers/systemd/caddy.container`, squarely under this runner's own
 *   `/etc/containers/systemd` prefix, and this SAME runner had just written it. `SourcePath` is
 *   the generator's own record of that file (systemctl.ts's header, MEASURED on CT100). So a
 *   generated unit is now also reachable when its `FragmentPath` is the generator's OWN output
 *   directory (`GENERATOR_DIRECTORIES` below) AND its `SourcePath` is under a declared prefix —
 *   the thing this runner actually owns is the `.container` file, and the generated unit is
 *   systemd's own derivative of it, not a foreign unit. Everything the check refused before still
 *   refuses: a vendor unit's `FragmentPath` (`/usr/lib/systemd/system/...`) is not under a
 *   generator directory at all; a generated unit with no `SourcePath`, or one outside every
 *   prefix (a `.container` file elsewhere in Quadlet's OWN search path —
 *   `podman-systemd.unit(5)` — that this runner was never told to own), still refuses.
 */
import type { ExecResult, HostRunner } from '../launchd/runner.ts';
import { GENERATED_UNIT_DIRECTORY } from './container-generator.ts';
import { SYSTEMCTL_ABS, SudoRefusedError, canonicalize, prefixOf } from './sudo-allowlist.ts';
import { type ChainExpect, assertGuardedChain } from './sudo-guard.ts';
import type { Elevate } from './sudo-write.ts';
import { parseShow } from './systemctl.ts';

/**
 * ★ ONLY THE `.late` VARIANT ADDED — `container-generator.ts`'s own header names it as part of
 *   systemd's real Unit File Load Path; `.early` is not named anywhere in this repo and no
 *   generator this family drives (Quadlet writes only the base directory) uses it, so it stays
 *   out rather than widen the check on an unmeasured guess.
 */
const GENERATOR_DIRECTORIES: readonly string[] = [
  GENERATED_UNIT_DIRECTORY,
  `${GENERATED_UNIT_DIRECTORY}.late`,
];

const isUnderGeneratorDirectory = (fragmentPath: string): boolean =>
  GENERATOR_DIRECTORIES.some((dir) => fragmentPath.startsWith(`${dir}/`));

const DIR_EXPECT: Readonly<Record<string, ChainExpect>> = {
  chmod: 'directory',
  chown: 'directory',
  mkdir: 'absent',
  rmdir: 'directory',
};

/** The only two verbs `deleteUnit` ever sends against a unit whose file may already be gone. */
const EMPTY_FRAGMENT_OK: ReadonlySet<string> = new Set(['stop', 'disable']);

const unitStatusOf = async (
  base: HostRunner,
  unit: string,
): Promise<{
  readonly fragmentPath: string;
  readonly loadState: string;
  readonly sourcePath: string;
}> => {
  const result = await base.exec([
    SYSTEMCTL_ABS,
    'show',
    '--no-pager',
    '-p',
    // ★ SourcePath added for the Quadlet-generated-unit exception below — same property
    //   systemctl.ts's own `showUnit` already reads for `Podman.Container`.
    'FragmentPath,LoadState,SourcePath',
    '--',
    unit,
  ]);
  if (result.exitCode !== 0) {
    throw new SudoRefusedError(
      `sshSudoRunner ${unit}: could not read FragmentPath/LoadState/SourcePath (systemctl show ` +
        `exit ${String(result.exitCode)}). Nothing ran as root.`,
    );
  }
  const fields = parseShow(result.stdout);
  return {
    fragmentPath: fields.get('FragmentPath') ?? '',
    loadState: fields.get('LoadState') ?? '',
    sourcePath: fields.get('SourcePath') ?? '',
  };
};

/** `argv` has already been routed to root; canonicalise it and run the read this shape needs. */
export const elevatedExec = (
  base: HostRunner,
  elevate: Elevate,
  prefixes: readonly string[],
  argv: readonly string[],
): Promise<ExecResult> => {
  const canonical = canonicalize(argv);
  const expect = DIR_EXPECT[argv[0] ?? ''];
  if (expect !== undefined) {
    const path = argv[argv.length - 1] ?? '';
    const prefix = prefixOf(path, prefixes);
    return elevate(canonical, {}, async () => {
      // ★ routeExec already required a prefix to route here; this re-derives it rather than
      //   trust the caller, so a future routing bug fails the guard instead of skipping it.
      if (prefix === undefined) {
        throw new SudoRefusedError(
          `sshSudoRunner ${path}: not under a declared prefix. Nothing ran as root.`,
        );
      }
      await assertGuardedChain(base, prefix, path, expect);
    });
  }
  if (canonical[0] !== SYSTEMCTL_ABS || canonical[1] === 'daemon-reload') return elevate(canonical);
  const verb = canonical[1] ?? '';
  const unit = canonical[3] ?? '';
  return elevate(canonical, {}, async () => {
    const { fragmentPath, loadState, sourcePath } = await unitStatusOf(base, unit);
    if (loadState === 'masked') {
      throw new SudoRefusedError(
        `sshSudoRunner ${unit}: is masked. Masking is someone's decision, not drift; unmask it ` +
          'deliberately, then redeploy. Nothing ran as root.',
      );
    }
    if (fragmentPath === '') {
      if (EMPTY_FRAGMENT_OK.has(verb)) return;
      throw new SudoRefusedError(
        `sshSudoRunner ${unit}: has no unit file (FragmentPath empty), and ${verb} is not ` +
          'stop/disable — refusing rather than run it against whatever systemd currently thinks ' +
          `${unit} is (a kernel-generated unit, say). Nothing ran as root.`,
      );
    }
    if (prefixOf(fragmentPath, prefixes) !== undefined) return;
    // ⛔ THE QUADLET CASE — see this file's header. A generator's OWN output directory is never a
    //   prefix, so this is not "found it under a prefix, done" — it is "found it under the
    //   generator, so check what GENERATED it instead."
    if (
      isUnderGeneratorDirectory(fragmentPath) &&
      sourcePath !== '' &&
      prefixOf(sourcePath, prefixes) !== undefined
    ) {
      return;
    }
    const sourceNote =
      sourcePath === '' ? '' : `, and its SourcePath ${sourcePath} is not under one either`;
    throw new SudoRefusedError(
      `sshSudoRunner ${unit}: FragmentPath ${fragmentPath} is outside every declared prefix ` +
        `(${prefixes.join(', ')})${sourceNote}; refusing to touch a unit this runner does not ` +
        'own. Nothing ran as root.',
    );
  });
};
