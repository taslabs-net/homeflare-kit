/**
 * The Quadlet half of the fake Linux host, layered on top of `fake-linux-host.ts`: a `daemon-reload`
 * that turns `.container` files into generated units the way `podman-system-generator` does, and a
 * `systemctl enable`/`disable` that FAILS the way it does on a live host.
 *
 * ⛔ TEST-ONLY, and not on the barrel — same rule as `fake-linux-host.ts`.
 * ★ WHAT IT MODELS, each cited in container-generator.ts's header: `daemon-reload` deletes and
 *   regenerates ALL generator output, so a `.container` file the (fake) generator refuses has no
 *   generated unit afterwards, even if one existed a moment ago; a generated unit carries
 *   `SourcePath=` back to its `.container` file; `enable`/`disable` on a generated unit fails.
 * ⚠️ WHAT IT DOES NOT MODEL: `UnitFileState` still reads `enabled`/`disabled` from the shared
 *   `fake-systemd.ts`, not the real `generated`. Nothing in `container-lifecycle.ts` branches on
 *   that field — only `LoadState`, `ActiveState`/`SubState` and `SourcePath` drive any decision —
 *   so a fresh string there would cost a fork of `fake-systemd.ts` for no behaviour under test.
 */
import { sha256Hex } from '../launchd/job-form.ts';
import { type FakeLinuxOptions, fakeLinuxHost } from './fake-linux-host.ts';
import { GENERATED_UNIT_DIRECTORY } from './container-generator.ts';
import { QUADLET_SEARCH_DIRECTORIES } from './container-form.ts';
import type { ExecResult, HostRunner } from '../launchd/runner.ts';

/** A line no real Quadlet key ever spells, so a test can force the (fake) generator to refuse a file. */
export const FAIL_GENERATOR_MARKER = 'X-Test-Fail-Generator=1';

const digest = (text: string) => sha256Hex(new TextEncoder().encode(text));
const decode = (bytes: Uint8Array | undefined) =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes);
const fail = (exitCode: number, stderr: string): ExecResult => ({ exitCode, stderr, stdout: '' });

export const fakeQuadletHost = (options: FakeLinuxOptions = {}) => {
  const base = fakeLinuxHost({
    dirs: { '/etc/systemd/system': 0, [QUADLET_SEARCH_DIRECTORIES[1]]: 0, ...options.dirs },
    ...options,
  });
  /** service name -> the `.container` path the (fake) generator last produced it from. */
  const sourcePaths = new Map<string, string>();

  const isQuadletFile = (path: string) =>
    path.endsWith('.container') &&
    QUADLET_SEARCH_DIRECTORIES.some((dir) => path.startsWith(`${dir}/`));

  const serviceFor = (containerPath: string) =>
    `${containerPath.slice(containerPath.lastIndexOf('/') + 1).replace(/\.container$/, '')}.service`;

  /**
   * ★ MEASURED (systemd.generator(7)): reload wipes and reruns generators from what is on disk
   *   now. So a stale generated file at `GENERATED_UNIT_DIRECTORY` is removed HERE for every
   *   service this reload does not (re)confirm — otherwise `fake-systemd.ts`'s own "a file
   *   appeared" sweep would find that stale file still sitting there and resurrect the unit from
   *   it, which is exactly backwards: real `daemon-reload` deletes it first.
   * ⚠️ REASONED, NOT MEASURED: what happens to an ALREADY-ACTIVE unit's `LoadState` when the file
   *   that generated it is wiped and the replacement fails — see container-generator.ts's header.
   *   This fake takes the CONSERVATIVE reading (the stale definition stops being `loaded`), which
   *   is the safer direction to be wrong in for a test suite: it exercises the refusal path this
   *   family relies on rather than silently passing a scenario a real host might handle more
   *   leniently through unit garbage-collection.
   */
  const regenerate = () => {
    const seen = new Set<string>();
    for (const [path, entry] of base.files) {
      if (!isQuadletFile(path)) continue;
      const service = serviceFor(path);
      seen.add(service);
      const text = decode(entry.bytes) ?? '';
      const generatedPath = `${GENERATED_UNIT_DIRECTORY}/${service}`;
      const existing = base.units.get(service);
      if (text.includes(FAIL_GENERATOR_MARKER)) {
        sourcePaths.delete(service);
        base.files.delete(generatedPath);
        // ★ Wiped, not merely stale: a unit that is not currently active stops being known at all,
        //   same rule `fake-systemd.ts`'s own sweep already applies when a unit file disappears.
        if (existing === undefined) continue;
        if (existing.active) existing.loadedSha = undefined;
        else base.units.delete(service);
        continue;
      }
      sourcePaths.set(service, path);
      base.placeUnit(generatedPath, text, {
        active: existing?.active ?? false,
        enabled: false,
        loadedSha: digest(text),
        ...(existing?.activeState === undefined ? {} : { activeState: existing.activeState }),
        ...(existing?.subState === undefined ? {} : { subState: existing.subState }),
      });
    }
    // A generated unit whose `.container` file is gone stops being generated — remove the stale
    // generated file (same reasoning as above) and, once it is not running, the unit itself.
    for (const service of sourcePaths.keys()) {
      if (seen.has(service)) continue;
      sourcePaths.delete(service);
      base.files.delete(`${GENERATED_UNIT_DIRECTORY}/${service}`);
      const existing = base.units.get(service);
      if (existing === undefined) continue;
      if (existing.active) existing.loadedSha = undefined;
      else base.units.delete(service);
    }
  };

  const runner: HostRunner = {
    ...base.runner,
    exec: async (argv) => {
      const verb = argv[1];
      if (argv[0] === 'systemctl' && (verb === 'enable' || verb === 'disable')) {
        // ⛔ MEASURED-DOC (podman-systemd.unit(5)): a generated unit is transient; enable/disable
        //   fails. Logged via `base.calls` so a test can assert it was never even ATTEMPTED.
        base.calls.push([...argv]);
        return fail(
          1,
          `Failed to ${verb} unit: unit ${argv.at(-1)} is transient or was generated by a ` +
            'generator, and cannot be enabled/disabled (podman-systemd.unit(5)).',
        );
      }
      if (argv[0] === 'systemctl' && verb === 'daemon-reload') regenerate();
      const result = await base.runner.exec(argv);
      if (argv[0] === 'systemctl' && verb === 'show') {
        const name = argv.at(-1) ?? '';
        return {
          ...result,
          stdout: `${result.stdout}\nSourcePath=${sourcePaths.get(name) ?? ''}\n`,
        };
      }
      return result;
    },
  };

  return { ...base, runner };
};
