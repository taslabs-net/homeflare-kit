/**
 * CaddyConfig's read / diff / reconcile as plain async functions over a CaddyAdmin, so the
 * lifecycle runs against a fake admin server in tests.
 *
 * The comparison is always between DIGESTS OF ADAPTED JSON (digest.ts): what `POST /adapt` makes
 * of the declared Caddyfile, what `GET /config/` reports, and what was stored after the last
 * apply. Three digests, because they answer different questions:
 *   · declared ≠ stored — the declaration changed.
 *   · live ≠ stored — DRIFT: a hand `curl` to the API, or a restart that loaded a different file
 *     (or an `autosave.json` holding someone else's change, under `--resume`).
 *   · declared = live — nothing to load, whatever the state says.
 */
import type { Diff } from 'alchemy/Diff';
import type { CaddyAdmin } from './admin.ts';
import {
  CaddyAdminError,
  adaptCaddyfile,
  loadCaddyfile,
  readRunningConfig,
} from './admin-calls.ts';
import { adminProblems } from './admin-guard.ts';
import {
  type CaddyConfigAttributes,
  type CaddyConfigProps,
  configProblems,
} from './config-form.ts';
import { configDigest } from './digest.ts';

const refuse = (admin: CaddyAdmin, message: string): Error =>
  new Error(`Caddy.Config at ${admin.endpoint}: ${message}`);

const short = (digest: string): string => digest.slice(0, 12);

type Desired = { readonly digest: string; readonly warnings: readonly string[] };

/**
 * ⛔ A CONFIG WITH NO APPS SERVES NOTHING. A Caddyfile of only comments or only global options
 *   passes the empty-text check (config-form.ts) yet adapts to `{}` or `{"admin":…}` — MEASURED
 *   2026-09-21 on a throwaway Caddy 2.11.4 — and loading it stops every server: the same outage,
 *   from the same templating bug, that the empty check exists to prevent.
 */
const servesNothing = (config: unknown): boolean => {
  const apps =
    typeof config === 'object' && config !== null ? (config as { apps?: unknown }).apps : undefined;
  return typeof apps !== 'object' || apps === null || Object.keys(apps).length === 0;
};

/**
 * Validate the props, adapt the Caddyfile on the running Caddy, and check its `admin` block.
 * ★ Every refusal happens HERE, before anything is loaded — and diff calls this at plan time, so a
 *   Caddyfile that does not adapt, carries a literal secret, or would strand the admin API fails the
 *   PLAN, before any resource (a HostFile holding the same text included) is applied.
 */
export const desiredConfig = async (
  admin: CaddyAdmin,
  props: CaddyConfigProps,
): Promise<Desired> => {
  const found = configProblems(props);
  if (found.length > 0) throw refuse(admin, found.join('; '));
  const adapted = await adaptCaddyfile(admin, props.caddyfile);
  if (servesNothing(adapted.config)) {
    throw refuse(admin, 'the Caddyfile adapts to no apps — loading it would stop every site');
  }
  const guard = adminProblems(adapted.config, admin.listener);
  if (guard.length > 0) throw refuse(admin, guard.join('; '));
  return { digest: configDigest(adapted.config), warnings: adapted.warnings };
};

/** What is running now, as attributes. `sourceFile` is carried over, never discovered. */
export const readLive = async (
  admin: CaddyAdmin,
  sourceFile?: string,
): Promise<CaddyConfigAttributes> => ({
  configSha256: configDigest(await readRunningConfig(admin)),
  endpoint: admin.endpoint,
  ...(sourceFile === undefined ? {} : { sourceFile }),
});

/**
 * ★ NEVER `replace`. Nothing in the props names a different object: a new Caddyfile is a reload of
 *   the same Caddy, and `sourceFile` is a header. (Which Caddy is the transport's business — see
 *   the ⚠️ on `endpoint` in the diff.)
 */
export const diffConfig = async (
  admin: CaddyAdmin,
  news: CaddyConfigProps,
  output: CaddyConfigAttributes,
): Promise<Diff> => {
  const want = await desiredConfig(admin, news);
  const live = await readLive(admin);
  const converged =
    want.digest === live.configSha256 &&
    live.configSha256 === output.configSha256 &&
    news.sourceFile === output.sourceFile &&
    // ⚠️ A stack whose transport now reaches ANOTHER Caddy (a new address) must load there; the
    //   old one keeps what it has — the same as a delete, which never unloads (see config.ts).
    admin.endpoint === output.endpoint;
  return converged ? { action: 'noop' } : { action: 'update' };
};

export type Applied = {
  readonly attributes: CaddyConfigAttributes;
  /** The adapter's warnings (e.g. "Caddyfile input is not formatted") — log them, never refuse. */
  readonly warnings: readonly string[];
  /** Whether a `POST /load` was sent (false when Caddy already ran this config). */
  readonly loaded: boolean;
};

/** Load the Caddyfile unless Caddy already runs it, then read it back and insist it matches. */
export const reconcileConfig = async (
  admin: CaddyAdmin,
  props: CaddyConfigProps,
): Promise<Applied> => {
  const want = await desiredConfig(admin, props);
  const before = configDigest(await readRunningConfig(admin));
  let warnings = want.warnings;
  const loaded = before !== want.digest;
  if (loaded) {
    try {
      warnings = await loadCaddyfile(admin, props.caddyfile, props.sourceFile);
    } catch (cause) {
      if (!(cause instanceof CaddyAdminError)) throw cause;
      // ★ SAY WHAT IS RUNNING NOW. Caddy restores the previous config on a failed load (caddy.go
      //   changeConfig); confirm it rather than promise it, because the deploy log is where the
      //   person decides whether sites are down.
      const after = await readLive(admin).catch(() => undefined);
      const state =
        after === undefined
          ? 'and the running config could not be read back'
          : after.configSha256 === before
            ? 'Caddy kept the previous config (still serving)'
            : `and the running config is now ${short(after.configSha256)}, not the previous ${short(before)}`;
      throw refuse(admin, `Caddy refused the Caddyfile — ${cause.message}; ${state}`);
    }
  }
  // ⚠️ READ BACK, never echo the declaration: a concurrent writer, or a load Caddy answered 200 but
  //   did not apply (admin-calls.ts), shows up here as a refusal instead of as stored state that is
  //   already wrong.
  const attributes = await readLive(admin, props.sourceFile);
  if (attributes.configSha256 !== want.digest) {
    throw refuse(
      admin,
      `after the load Caddy runs config ${short(attributes.configSha256)}, not the ` +
        `${short(want.digest)} this Caddyfile adapts to — another writer changed it, or it was not applied`,
    );
  }
  return { attributes, loaded, warnings };
};
