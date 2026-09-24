# Caddy — `@homeflare/alchemy/caddy`

Declare a running Caddy's config as Caddyfile text and apply it through Caddy's own admin API:
`POST /load` to apply (a graceful reload), `GET /config/` to detect drift. `caddyWithFile()` also
writes the same Caddyfile to the file Caddy starts from, with launchd's `HostFile`, so a restart
keeps it. Every admin call goes through `@distilled.cloud/caddy`'s typed operations, over one
injectable `CaddyTransport` (`Credentials` + `HttpClient.HttpClient`).

```ts
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { caddyProviders, caddyWithFile } from '@homeflare/alchemy/caddy';
import { LaunchdJob, launchdProviders } from '@homeflare/alchemy/launchd';

const caddyfile = `app.example.com {
\treverse_proxy 127.0.0.1:8080
\ttls {
\t\tdns cloudflare {env.CF_API_TOKEN}
\t}
}
`;

export const edge = Effect.gen(function* () {
  const { file } = yield* caddyWithFile('caddy', { caddyfile, path: '/usr/local/etc/Caddyfile' });
  yield* LaunchdJob('caddy-daemon', {
    label: 'com.example.caddy',
    domain: 'system',
    // --resume: a restart runs the last config Caddy accepted (see Managed Caddies below).
    // --envfile: a file a secret renderer (openbao-agent) writes; {env.CF_API_TOKEN} reads it.
    programArguments: [
      '/usr/local/bin/caddy',
      'run',
      '--resume',
      '--config',
      file.path,
      '--adapter',
      'caddyfile',
      '--envfile',
      '/usr/local/etc/caddy.env',
    ],
    // ⛔ Here, not in the envfile: Caddy fixes its autosave path before it reads --envfile.
    environment: { XDG_CONFIG_HOME: '/usr/local/var/caddy-edge' },
    runAtLoad: true,
    keepAlive: true,
  });
});
// ★ launchdProviders() for the HostFile and the job; caddyProviders() for the config.
export const providers = Layer.mergeAll(caddyProviders(), launchdProviders());
```

## CaddyConfig

| prop         | notes                                                                        |
| ------------ | ---------------------------------------------------------------------------- |
| `caddyfile`  | the whole Caddyfile; it REPLACES the running config. ⛔ never a secret       |
| `sourceFile` | the file Caddy was started with; `caddyWithFile()` sets it from its HostFile |

| attribute      | what                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| `configSha256` | SHA-256 of the adapted JSON Caddy reported after the apply — never the config itself |
| `endpoint`     | where the admin API was reached                                                      |
| `sourceFile`   | as applied                                                                           |

| step    | what happens                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| plan    | `POST /adapt` the Caddyfile (side-effect free): a syntax error, a literal secret, no apps or an unsafe `admin` block fails the **plan**            |
| apply   | `POST /load` with `text/caddyfile`, then `GET /config/` must hash to what `/adapt` produced; skipped when Caddy already runs it                    |
| refused | Caddy keeps the old config (it rolls back itself); the deploy fails with Caddy's reason and says whether the old config is still running           |
| read    | the digest of `GET /config/`; with no state, the adoption probe — ⛔ a config that is not the declared one needs `--adopt` ([Adoption](#adoption)) |
| drift   | live ≠ stored → `update`: a hand `curl` to the API, or a restart that loaded a different file                                                      |
| replace | never — a new Caddyfile is a reload of the same Caddy                                                                                              |
| delete  | ⛔ nothing. See [Removing it](#removing-it)                                                                                                        |

The digests compare adapted JSON, not bytes: `/adapt` answers Go struct order, `GET /config/` sorted
keys with `<>&` escaped and a trailing newline. `digest.ts` erases all three. ★ Measured 2026-09-21
against a throwaway Caddy 2.11.4: the digests agree after a load and for a Caddy started from the
same file, and a refused load kept serving the old config and answered **200** with the error after
the adapter's warnings, which the provider still reports as a refusal.

⚠️ **A stopped Caddy does not fail the plan.** Its launchd job may be the fix in the same stack, so
`read` and `diff` plan a create/update with a warning (the plan-time `/adapt` did not run). The apply
still needs Caddy, and fails loudly until it answers.

## Formatting

`formatCaddyfile(text)` runs the local `caddy fmt -` binary (there is no admin API for it). Plan
and deploy both surface Caddy's own "not formatted" warning as one clear line naming the fix —
formatting never changes the adapted JSON, so it can never cause drift. Details, the error types
and the exact log line: [caddy-fmt.md](./caddy-fmt.md).

## Order: file, then `/load`

`caddyWithFile()` passes the HostFile's `path` Output into the CaddyConfig, so Alchemy writes the
file first. It is the only order that bootstraps: a new host's Caddy job starts from the file,
before any admin API exists to load into. What bounds the cost:

- ★ **A Caddyfile that does not adapt never reaches disk** once the config has state: the plan-time
  `/adapt` fails the plan. On the very first deploy the path is still an Output, Alchemy skips the
  adoption probe, and the check runs at apply instead.
- ⚠️ **A Caddyfile that adapts but that Caddy refuses** (a port in use, a missing cert file) is on
  disk when `/load` fails. Caddy keeps serving the old config, and a managed Caddy's restart runs its
  autosave, not the refused file (below). Without `--resume` a **restart before the fix loads the
  refused file**: fix and redeploy.
- ⛔ Secrets are refused at declaration, before the HostFile exists (its `content` is a prop too).
- ★ Both resources retain: removing them from a stack leaves the file a restart needs.

## Managed Caddies: `--resume` and their own config dir

★ **Decision, 2026-09-21.** A Caddy this package manages runs `caddy run --resume --config <file>`
with `XDG_CONFIG_HOME` set to a directory of its own, so a restart runs the last config Caddy
**accepted**. After every successful load (ours included) Caddy writes the config JSON to
`$XDG_CONFIG_HOME/caddy/autosave.json`; `--resume` starts from it, and from `--config` only when no
autosave exists (cmd/commandfuncs.go cmdRun). Read in caddyserver/caddy v2.11.4:

- ★ **A refused Caddyfile on disk cannot take sites down.** The file is the first-boot fallback: a
  new host, or an autosave someone deleted.
- ★ **Its own directory,** so nothing else (a Homebrew service, a person's `caddy run`) writes the
  autosave it resumes from. With neither `HOME` nor `XDG_CONFIG_HOME` a daemon would use `./caddy/`
  under its working directory (storage.go AppConfigDir).
- ⛔ **Set `XDG_CONFIG_HOME` in the job's `environment`, not the envfile.** The autosave path is
  fixed when the binary starts (storage.go `var ConfigAutosavePath`), before `--envfile` is read.
- ⛔ **No `persist_config off`** in a managed Caddyfile. It stops the autosave, so `--resume` starts
  from a stale one (the last config before it) or, with none, from the file.
- ⚠️ **A hand change through the API survives a restart.** The next plan reports it as drift, and the
  deploy puts the declaration back.
- ⚠️ **SIGUSR1 is not a way to change config.** After a resumed start Caddy records no source file
  (cmdRun calls `SetLastConfig` only after loading `--config`), so SIGUSR1 is ignored with the log
  line `last config unknown`. Our `Caddy-Config-Source-File` header keeps a source Caddy already
  has (caddy.go ClearLastConfigIfDifferent) and never sets one. After a first boot from the file,
  SIGUSR1 still reloads it: the text the deploy wrote. Change config by deploying. Editing the file
  and running `caddy reload` is a hand `/load`, which the next plan reports as drift.
- ⛔ **No `--watch`.** After a resumed start it has no file to watch, and falls back to a `Caddyfile`
  in the working directory (cmd/main.go watchConfigFile).

A Caddy not yet moved over (no `--resume`) restarts from `--config`: see the ⚠️ in
[Order](#order-file-then-load).

## Secrets

Alchemy stores props unencrypted, and the Caddyfile is a prop. Use RUNTIME placeholders, which Caddy
resolves in its own process, so the value never enters the state, the adapted JSON or the autosave:

- `{env.NAME}` — start Caddy with `--envfile <path>`; a secret renderer (openbao-agent) writes that
  file. A rotated value needs a Caddy restart.
- `{file./path}` — the file's contents (trailing newline trimmed), read when the placeholder runs.
- ⚠️ `{$NAME}` is substituted at **adapt** time: the value is in the adapted JSON, readable at
  `GET /config/` and written to `autosave.json`. Not refused, but worse.
- ⛔ `{$NAME:default}` puts the default in the prop, and Caddy uses it whenever `NAME` is unset. The
  tripwire checks the default as a literal.
- `basic_auth` replaces placeholders in the hash too: `admin {env.ADMIN_HASH}`.

The tripwire refuses a PEM private key, a literal after `dns`/`acme_dns <provider>`, a secret-named
subdirective (`api_token`, `client_secret`, `password`, …) with a literal value, a literal
`Authorization`/`Cookie`/`X-Api-Key` header, and token shapes (GitHub, AWS, Slack, `sk-…`, JWT,
bcrypt/argon2 hashes). It never echoes what it found. It is a tripwire, not a scanner.

## The admin endpoint

⛔ The admin API has no authentication: `localCaddyAdmin()` accepts only `http://` loopback or
`unix:///path` (default `http://127.0.0.1:2019`), and a Caddyfile whose `admin` block would move,
expose or lock out the API is refused before it loads. Host/Origin checks, narrowed `origins`, SSH
forwards and every refusal: [caddy-admin.md](./caddy-admin.md).

## Adoption

★ **Nothing is adopted silently** (decision, 2026-09-21) — the rule `HostFile` and `LaunchdJob` keep.
With no state, `read` is Alchemy's adoption probe, and what the Caddy runs decides:

| running                             | read      | plan                                                       |
| ----------------------------------- | --------- | ---------------------------------------------------------- |
| the declared config (same digest)   | ours      | adopted; the forced update loads nothing                   |
| nothing (`null`, or no apps)        | absent    | create — nothing to take over, as an empty R2 lock is none |
| anything else                       | `Unowned` | refused unless the deploy runs with `--adopt`              |
| a Caddyfile that cannot be compared | `Unowned` | the same, with a warning saying why                        |
| no Caddy answering                  | absent    | create, with a warning; the apply checks again             |

- ⚠️ **Alchemy skips the probe while the props hold an Output** — always on `caddyWithFile()`'s first
  deploy, whose `sourceFile` is the HostFile's path. So the apply of a create checks too, and fails
  before any `/load` unless the deploy runs with `--adopt`. The HostFile is written by then (a file
  already at the path is the HostFile's own `Unowned`); under `--resume` a restart still runs the
  autosave.
- ★ **That apply-time check resolves adoption as the planner does:** a resource-scoped `adopt(…)`,
  else `--adopt`. So `.pipe(adopt(false))` still refuses under `--adopt`, and `adopt(true)` works.
- ★ **An uncomparable Caddyfile is `Unowned`, not an error**: the same read recovers an interrupted
  create with that deploy's props, and a throw would fail every later plan, the fixed one included.

## Removing it

⛔ Delete never touches Caddy, under either removal policy. There is no "less config" to fall back
to, and an empty config stops every server. `retain` is the default; with `destroy`, delete still
only forgets. It never calls `/stop` or `DELETE /config/`. An empty Caddyfile, or one that adapts
to no apps (only comments or global options), is refused for the same reason. To empty a Caddy, do
it by hand at its admin API.

## Traps

- ⚠️ `import` paths resolve against Caddy's working directory (the API adapts with no file name).
  Keep them absolute.
- ⚠️ `/adapt` runs on the **running** binary. A Caddyfile that uses a plugin's directive (Cloudflare
  DNS, caddy-security, layer4) needs that custom build running before it will validate.
- ⚠️ **Bootstrap race.** Where Caddy is not running yet, the config can reach the admin API before
  its launchd job has Caddy listening. The transport retries a refused connection (`retries`,
  `retryDelayMs`; default 2 × 500 ms) — raise them, or rerun the deploy.
- ⚠️ One `CaddyTransport` per stack: the transport picks the Caddy, not a prop. Pointing it at another
  Caddy plans an update; the old one keeps what it had. ⛔ State vouches only for the Caddy it was
  applied to, so the apply loads there only if it serves nothing, runs the declared config or the
  one last stored — anything else needs `--adopt`.
