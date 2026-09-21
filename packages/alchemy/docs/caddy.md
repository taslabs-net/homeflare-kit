# Caddy — `@homeflare/alchemy/caddy`

Declare a running Caddy's config as Caddyfile text and apply it through Caddy's own admin API:
`POST /load` to apply (a graceful reload), `GET /config/` to detect drift. `caddyWithFile()` also
writes the same Caddyfile to the file Caddy starts from, with launchd's `HostFile`, so a restart
keeps it. Every admin call goes through one injectable `CaddyAdmin` transport.

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
    // --envfile: a file a secret renderer (openbao-agent) writes; {env.CF_API_TOKEN} reads it.
    programArguments: [
      '/usr/local/bin/caddy',
      'run',
      '--config',
      file.path,
      '--adapter',
      'caddyfile',
      '--envfile',
      '/usr/local/etc/caddy.env',
    ],
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

| step    | what happens                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| plan    | `POST /adapt` the Caddyfile (side-effect free): a syntax error, a literal secret, no apps or an unsafe `admin` block fails the **plan**  |
| apply   | `POST /load` with `text/caddyfile`, then `GET /config/` must hash to what `/adapt` produced; skipped when Caddy already runs it          |
| refused | Caddy keeps the old config (it rolls back itself); the deploy fails with Caddy's reason and says whether the old config is still running |
| read    | the digest of `GET /config/` — with no state, a running Caddy is **adopted** (its live config becomes the baseline)                      |
| drift   | live ≠ stored → `update`: a hand `curl` to the API, or a restart that loaded a different file                                            |
| replace | never — a new Caddyfile is a reload of the same Caddy                                                                                    |
| delete  | ⛔ nothing. See [Removing it](#removing-it)                                                                                              |

The digests compare adapted JSON, not bytes: `/adapt` answers Go struct order, `GET /config/` sorted
keys with `<>&` escaped and a trailing newline. `digest.ts` erases all three. ★ Measured 2026-09-21
against a throwaway Caddy 2.11.4: the digests agree after a load and for a Caddy started from the
same file, and a refused load kept serving the old config and answered **200** with the error after
the adapter's warnings, which the provider still reports as a refusal.

⚠️ **A stopped Caddy does not fail the plan.** Its launchd job may be the fix in the same stack, so
`read` and `diff` plan a create/update with a warning (the plan-time `/adapt` did not run). The apply
still needs Caddy, and fails loudly until it answers.

## Order: file, then `/load`

`caddyWithFile()` passes the HostFile's `path` Output into the CaddyConfig, so Alchemy writes the
file first. It is the only order that bootstraps: a new host's Caddy job starts from the file,
before any admin API exists to load into. What bounds the cost:

- ★ **A Caddyfile that does not adapt never reaches disk** once the config has state: the plan-time
  `/adapt` fails the plan. On the very first deploy the path is still an Output, Alchemy skips the
  adoption probe, and the check runs at apply instead.
- ⚠️ **A Caddyfile that adapts but that Caddy refuses** (a port in use, a missing cert file) is on
  disk when `/load` fails. Caddy keeps serving the old config — but a **restart before the fix loads
  the refused file**. Fix and redeploy, or run Caddy with `--resume` (below).
- ⛔ Secrets are refused at declaration, before the HostFile exists (its `content` is a prop too).
- ★ Both resources retain: removing them from a stack leaves the file a restart needs.

## Autosave and `--resume`

After every successful load (ours included) Caddy writes the config JSON to `autosave.json`
(`$XDG_CONFIG_HOME/caddy/`, else `~/Library/Application Support/Caddy/` on macOS, `~/.config/caddy/`
on Linux), unless the Caddyfile says `persist_config off`. ⚠️ A daemon started with no `HOME` and no
`XDG_CONFIG_HOME` falls back to `./caddy/` under its working directory (storage.go AppConfigDir):
set `XDG_CONFIG_HOME` in the launchd job so autosave lands where you expect.

- **Without `--resume`** (the mini's Caddy today): a restart loads `--config`. The file and the
  running config agree after every successful deploy; see the ⚠️ above for a failed one.
- **With `caddy run --resume --config <file>`**: a restart loads `autosave.json` — the last config
  Caddy **accepted** — and `--config` only when no autosave exists. A refused file on disk can then
  never take sites down. The trade: a hand change through the API also survives a restart; the next
  plan reports it as drift and the deploy puts the declaration back.
- `--watch` reloads the file on change; our `/load` right after is then a no-op ("config is
  unchanged").
- `sourceFile` rides as `Caddy-Config-Source-File`, as `caddy reload` sends it. Without it a load
  makes Caddy forget its source file, and SIGUSR1 stops reloading from it. The header only KEEPS the
  file Caddy started with (caddy.go ClearLastConfigIfDifferent); it never sets a new one. ⚠️ Under
  `--resume` with an autosave, Caddy records no source file at all, so SIGUSR1 has nothing to reload.

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

⛔ The admin API has no authentication. `localCaddyAdmin()` accepts only `http://` loopback
(`127.0.0.0/8`, `localhost`, `[::1]`) or `unix:///path`; the default is `http://127.0.0.1:2019`.

- **Host and Origin.** Caddy refuses a request whose `Host` is not an allowed origin (DNS-rebinding
  guard; measured on Caddy 2.11.4: `403 host not allowed`), and checks `Origin` when one is sent or
  `enforce_origin` is on. The transport sends both as the Caddy CLI does. A unix socket skips the
  Host check entirely.
- **`admin { origins … }`** narrowed, or **an SSH-forwarded port** (Caddy checks the Host against
  ITS port): pass `hostHeader: 'localhost:2019'`.
- **Another host's Caddy** (SSH later): forward its socket or port to loopback here and point a
  `localCaddyAdmin()` at it, or implement `CaddyAdmin` over your own route. Never expose :2019.
- **A Caddyfile cannot strand the provider.** Before loading, the adapted `admin` block is refused
  if it turns the API off, listens off loopback or somewhere the transport does not reach (another
  port, socket or loopback address: `[::1]` is not `127.0.0.1`, and `localhost` binds IPv4), allows
  no Host the transport sends (its `origins`, or Caddy's loopback defaults when there are none), sets
  `enforce_origin` over a unix socket (no Origin is sent there), enables `remote`, or pulls config.
- ⛔ **No `admin` address means Caddy's default** (`localhost:2019`, or `$CADDY_ADMIN`) after the
  load. That is refused unless the transport is at that default: a Caddy reached on a socket or
  another port declares `admin <address>` in its Caddyfile.

## Adoption

With no state, `read` reports the running Caddy's live config as plain (owned) attributes, so the
first deploy adopts it silently and its forced update loads the declared Caddyfile — a full replace
of whatever ran before. ⚠️ Review the plan: the Caddy on this loopback admin API is the one you get.

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
- ⚠️ One `CaddyAdmin` per stack: the transport picks the Caddy, not a prop. Pointing it at another
  Caddy plans an update that loads there; the old one keeps what it had.
