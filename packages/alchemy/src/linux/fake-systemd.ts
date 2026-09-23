/**
 * The systemd half of the fake Linux host: a `systemctl` that behaves the way systemctl.ts measured
 * the real one behaving. ⛔ TEST-ONLY, and not on the barrel.
 *
 * ★ THE ONE BEHAVIOUR EVERYTHING ELSE RESTS ON: `show` of a unit that does not exist EXITS 0 and
 *   answers `LoadState=not-found`. A fake that returned an error there would let a provider bug
 *   through that reads the exit code instead of the load state — which is the bug the real host's
 *   measurement exists to prevent.
 */
import type { ExecResult } from '../launchd/runner.ts';

export type UnitState = {
  /** What systemd has loaded; `undefined` once it has been unloaded. */
  loadedSha: string | undefined;
  active: boolean;
  enabled: boolean;
  masked?: boolean;
  /**
   * Force `ActiveState` to a value `start`/`stop`/`restart` below never produce, for tests: a
   * timer-driven oneshot mid-run (`activating`, `active` left `false`) or a crashed unit (`failed`).
   * ⚠️ REASONED NOT MEASURED — a synthetic override to exercise unit-form.ts's `isUnitRunning`
   *   exactly, not a systemd state-machine model; see fake-linux-host.ts's `placeUnit`.
   */
  activeState?: 'activating' | 'failed';
  /**
   * Force `SubState` independent of the default derived from `activeState` — `'start'` is already
   * the default for `activeState: 'activating'` and is accepted here only so a test can say so
   * explicitly. Systemd's crash-restart backoff (`auto-restart` / `auto-restart-queued`, both still
   * `ActiveState=activating` — systemd's `service.c` `state_translation_table`) needs
   * `activeState: 'activating'` ABOVE plus one of these, to tell it apart from a genuine start.
   */
  subState?: 'start' | 'auto-restart' | 'auto-restart-queued';
};

export type FakeSystemdDeps = {
  readonly units: Map<string, UnitState>;
  /** Every unit-file path the host holds, so a reload can notice a new one. */
  readonly files: { keys: () => Iterable<string> };
  /** The text of a unit's file, or `undefined` when it has none. */
  readonly fileFor: (name: string) => string | undefined;
  /** The text at one path, for the reload sweep. */
  readonly fileAt: (path: string) => string | undefined;
  readonly pathOf: (name: string) => string;
  readonly digest: (text: string) => string;
  /** ⛔ Make every `show` fail, to prove a failed READ refuses instead of writing. */
  readonly failShow: boolean;
};

const ok = (stdout = ''): ExecResult => ({ exitCode: 0, stderr: '', stdout });
const fail = (exitCode: number, stderr: string): ExecResult => ({ exitCode, stderr, stdout: '' });

export const fakeSystemd = (deps: FakeSystemdDeps) => {
  return (args: readonly string[]): ExecResult => {
    const verb = args[0];
    const name = args.at(-1) ?? '';
    const state = deps.units.get(name);
    const onDisk = deps.fileFor(name);
    if (verb === 'show') {
      // ⛔ MEASURED: exit 0 even for a unit that does not exist.
      if (deps.failShow) return fail(1, 'Failed to connect to bus: No such file');
      const known = state !== undefined || onDisk !== undefined;
      const loaded = state?.loadedSha !== undefined;
      // ★ `activeState`/`subState` (above) override the plain active/inactive read for a state
      //   start/stop/restart never produce on their own — see `UnitState.activeState`.
      const activeState = state?.activeState ?? (state?.active === true ? 'active' : 'inactive');
      const subState =
        state?.subState ??
        (activeState === 'activating'
          ? 'start'
          : activeState === 'failed'
            ? 'failed'
            : activeState === 'active'
              ? 'running'
              : 'dead');
      return ok(
        [
          `Id=${name}`,
          `LoadState=${state?.masked === true ? 'masked' : known && loaded ? 'loaded' : 'not-found'}`,
          `ActiveState=${activeState}`,
          `SubState=${subState}`,
          `UnitFileState=${state?.masked === true ? 'masked' : onDisk === undefined ? '' : state?.enabled === true ? 'enabled' : 'disabled'}`,
          `FragmentPath=${onDisk === undefined ? '' : deps.pathOf(name)}`,
          `NeedDaemonReload=${onDisk !== undefined && state?.loadedSha !== deps.digest(onDisk) && loaded ? 'yes' : 'no'}`,
        ].join('\n'),
      );
    }
    if (verb === 'daemon-reload') {
      for (const [unit, current] of deps.units) {
        const text = deps.fileFor(unit);
        if (text !== undefined) current.loadedSha = deps.digest(text);
        // ★ A unit whose file is gone and that is not running stops being a unit systemd knows.
        else if (!current.active) deps.units.delete(unit);
      }
      // ★ A unit file that appeared since the last reload becomes a unit systemd knows about.
      for (const path of deps.files.keys()) {
        const unit = path.slice(path.lastIndexOf('/') + 1);
        const text = deps.fileAt(path);
        if (text !== undefined && deps.pathOf(unit) === path && !deps.units.has(unit)) {
          deps.units.set(unit, { active: false, enabled: false, loadedSha: deps.digest(text) });
        }
      }
      return ok();
    }
    const current = deps.units.get(name);
    if (current === undefined || onDisk === undefined) {
      return fail(5, `Failed to ${String(verb)} ${name}: Unit ${name} not found.`);
    }
    if (current.masked === true) return fail(1, `Unit ${name} is masked.`);
    if (verb === 'enable') {
      if (!onDisk.includes('[Install]')) {
        return fail(1, `The unit files have no installation config (WantedBy=, ...).`);
      }
      current.enabled = true;
      return ok();
    }
    if (verb === 'disable') {
      current.enabled = false;
      return ok();
    }
    if (verb === 'start' || verb === 'restart') {
      current.active = true;
      // ★ A real start/restart leaves whatever synthetic `activating`/`auto-restart` snapshot a
      //   test placed and lands the unit in an ordinary `active` — the override does not survive
      //   an actual systemctl action, any more than it would on a real host.
      delete current.activeState;
      delete current.subState;
      return ok();
    }
    if (verb === 'stop') {
      current.active = false;
      delete current.activeState;
      delete current.subState;
      return ok();
    }
    return fail(64, `fake systemctl: unsupported ${args.join(' ')}`);
  };
};
