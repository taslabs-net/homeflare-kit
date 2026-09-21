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
 * With NO state there is no stored digest, and the question is whose config is running: see
 * `claimable` below, which both the adoption probe and the apply ask.
 */
import type { Diff } from 'alchemy/Diff';
import { type CaddyAdmin, CaddyUnreachableError } from './admin.ts';
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

const attributesOf = (
  admin: CaddyAdmin,
  running: unknown,
  sourceFile?: string,
): CaddyConfigAttributes => ({
  configSha256: configDigest(running),
  endpoint: admin.endpoint,
  ...(sourceFile === undefined ? {} : { sourceFile }),
});

/** What is running now, as attributes. `sourceFile` is carried over, never discovered. */
export const readLive = async (
  admin: CaddyAdmin,
  sourceFile?: string,
): Promise<CaddyConfigAttributes> =>
  attributesOf(admin, await readRunningConfig(admin), sourceFile);

/**
 * ⛔ WITH NO STATE, A RUNNING CONFIG IS THIS STACK'S ONLY IF IT IS THE DECLARED ONE (decision,
 *   2026-09-21: CaddyConfig must not adopt silently — the house rule HostFile and LaunchdJob keep).
 *   Anything else was put there by a person, another tool or another stack, and loading over it
 *   replaces every site it serves. ★ A config that serves nothing (`null`, or no apps) is claimable
 *   too: there is nothing to take over, as an empty R2 lock rule set reads as no lock.
 */
export const claimable = (running: unknown, declaredDigest: string): boolean =>
  servesNothing(running) || configDigest(running) === declaredDigest;

export type Probe = {
  readonly attributes: CaddyConfigAttributes;
  /** The live config IS the declared one: adopting it changes nothing. */
  readonly ours: boolean;
  /** Why the declaration could not be compared, when it could not — the Caddy is then not ours. */
  readonly unchecked?: string;
};

/**
 * The adoption probe — `read` with no state: `undefined` when Caddy serves nothing (plan a create),
 * else the live attributes and whether they are provably ours (the provider brands the rest
 * `Unowned`, and the plan refuses them without `--adopt`).
 * ⛔ IT NEVER THROWS OVER THE DECLARATION. The engine also runs this read to recover an interrupted
 *   create, with THAT deploy's props (Plan.ts, `status: "creating"`) — so a Caddyfile that failed to
 *   adapt then would fail every later plan, the one carrying the fix included. What cannot be
 *   compared is "not proven ours", with the reason; the next diff or apply validates the Caddyfile.
 */
export const probeLive = async (
  admin: CaddyAdmin,
  caddyfile: string | undefined,
  sourceFile?: string,
): Promise<Probe | undefined> => {
  const running = await readRunningConfig(admin);
  if (servesNothing(running)) return undefined;
  const attributes = attributesOf(admin, running, sourceFile);
  if (caddyfile === undefined) {
    return { attributes, ours: false, unchecked: 'the stored Caddyfile is not plain text' };
  }
  try {
    const want = await desiredConfig(admin, { caddyfile });
    return { attributes, ours: claimable(running, want.digest) };
  } catch (cause) {
    // ⚠️ Unreachable mid-probe is still "no Caddy" (config.ts plans without it), not "not ours".
    if (cause instanceof CaddyUnreachableError) throw cause;
    return {
      attributes,
      ours: false,
      unchecked: cause instanceof Error ? cause.message : String(cause),
    };
  }
};

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
    //   Planned as an update, but the state does not vouch for that Caddy: see Authority.
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

/**
 * What this apply may load over — config.ts decides from the state and `--adopt`:
 *   · `takeOver` — any running config: the state was applied to THIS Caddy (an update, drift
 *     correction, or a create the engine adopted), or the deploy runs with `--adopt`.
 *   · otherwise only a claimable one — plus, as `stored`, the digest the state last recorded: a
 *     Caddy reached at a NEW endpoint that runs exactly that is the same config under another name.
 */
export type Authority = { readonly takeOver: boolean; readonly stored?: string };

/**
 * Load the Caddyfile unless Caddy already runs it, then read it back and insist it matches.
 * ⛔ WITHOUT `takeOver`, A CONFIG THE STACK CANNOT CLAIM IS NEVER LOADED OVER. The engine's adoption
 *   probe cannot guard every create: it is skipped while `news` holds an Output — ALWAYS on
 *   caddyWithFile's first deploy (`sourceFile` is its HostFile's path) — and a Caddy that was down at
 *   plan time read as nothing. Nor does state vouch for a Caddy the transport NOW reaches at another
 *   endpoint (diff plans that as an update). Refused here, before any `/load`, like HostFile's.
 */
export const reconcileConfig = async (
  admin: CaddyAdmin,
  props: CaddyConfigProps,
  authority: Authority,
): Promise<Applied> => {
  const want = await desiredConfig(admin, props);
  const running = await readRunningConfig(admin);
  const before = configDigest(running);
  const known = before === authority.stored || claimable(running, want.digest);
  if (!authority.takeOver && !known) {
    throw refuse(
      admin,
      `Caddy runs config ${short(before)}, which this stack did not load, and the Caddyfile adapts ` +
        `to ${short(want.digest)} — loading it would replace every site that config serves. ` +
        'Deploy with --adopt to take this Caddy over, or point caddyProviders() at the Caddy you meant.',
    );
  }
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
