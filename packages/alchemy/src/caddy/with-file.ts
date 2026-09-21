/**
 * `caddyWithFile` — one Caddyfile, applied to the running Caddy AND written to the file Caddy
 * starts from, so a restart keeps it (decision 23: "the file also lands on disk").
 *
 * ★ REUSES launchd's HostFile, NOT A SECOND FILE WRITER. The file is an ordinary `Host.File`
 *   (atomic write, digest diff, symlink refusal, `--adopt` for a file already there); the config is
 *   a `Caddy.Config` whose `sourceFile` is that HostFile's `path` Output — which is what orders them.
 *
 * ⛔ THE ORDER IS FILE, THEN `/load`. The dependency makes Alchemy write the file first, and it is the
 *   only order that bootstraps: a new host's Caddy launchd job starts from the file, before any
 *   admin API exists to load into. Its cost, and what bounds it:
 *   · A Caddyfile that does not ADAPT never reaches disk once the config has state: CaddyConfig's
 *     diff adapts it at PLAN time and fails the plan. (On the very first deploy the file's path is
 *     still an Output, Alchemy skips the adoption probe, and the check runs at apply instead.)
 *   · A Caddyfile that adapts but that Caddy then REFUSES (a port in use, a missing cert file) is
 *     on disk when `/load` fails. Caddy keeps serving the old config, the deploy fails with Caddy's
 *     reason — and a RESTART before the fix would load the refused file. Fix and redeploy, or run
 *     Caddy with `--resume` (docs/caddy.md): it restarts from `autosave.json`, the last config Caddy
 *     ACCEPTED, and the file is only the first-boot fallback.
 * ⛔ SECRETS ARE REFUSED HERE, AT DECLARATION, before the HostFile exists: its `content` is a prop
 *   too, and would carry a literal into state even if the CaddyConfig then refused it.
 * ★ BOTH RETAIN. Removing this from a stack must not delete the file a restart needs.
 */
import * as Effect from 'effect/Effect';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import { HostFile } from '../launchd/host-file.ts';
import { CaddyConfig } from './config.ts';
import { configProblems } from './config-form.ts';

export interface CaddyWithFileProps {
  /** The whole Caddyfile. ⛔ Never a secret — use `{env.NAME}` / `{file./path}` placeholders. */
  readonly caddyfile: string;
  /** Absolute path Caddy is started with: `caddy run --config <path> --adapter caddyfile`. */
  readonly path: string;
  /** @default 0o644 */
  readonly mode?: number;
  readonly owner?: string | number;
  readonly group?: string | number;
}

/**
 * Declare the file (`<id>-file`) and the config (`<id>`). Provide `launchdProviders()` for the
 * file and `caddyProviders()` for the config.
 *
 *     const { config, file } = yield* caddyWithFile('caddy', { caddyfile, path: '/usr/local/etc/Caddyfile' });
 */
export const caddyWithFile = (id: string, props: CaddyWithFileProps) =>
  Effect.gen(function* () {
    const found = configProblems({ caddyfile: props.caddyfile, sourceFile: props.path });
    if (found.length > 0) {
      return yield* Effect.fail(new Error(`caddyWithFile ${id}: ${found.join('; ')}`));
    }
    const file = yield* HostFile(`${id}-file`, {
      content: props.caddyfile,
      mode: props.mode ?? 0o644,
      path: props.path,
      ...(props.owner === undefined ? {} : { owner: props.owner }),
      ...(props.group === undefined ? {} : { group: props.group }),
    }).pipe(RemovalPolicy.retain());
    const config = yield* CaddyConfig(id, { caddyfile: props.caddyfile, sourceFile: file.path });
    return { config, file };
  });
