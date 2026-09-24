# `Podman.Container` — `@homeflare/alchemy/linux`

Status: active
Verified: 2026-09-24

One Podman [Quadlet](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)
`.container` file, declared, plus the systemd unit Podman's own generator
turns it into — the container half of [linux-host.md](./linux-host.md)'s
`Systemd.Unit` family, over the same `HostRunner` seam.

★ **Why not `Docker.Container`.** Upstream Alchemy's resource was measured and
rejected for three reasons: no host-network prop (every container CT100 runs
uses `--network host`), `environment` puts `Redacted` secrets in Alchemy state,
and systemd already supervises the containers this stack declares. Quadlet
sidesteps all three: `Network=host` is a real value, `Environment=` is refused
if it looks like a secret (below), and the GENERATED unit is what systemd
supervises — this resource only ever declares the `.container` file that
produces it.

## Keys checked against the doc, not invented

Every `[Container]` key below is checked against `podman-systemd.unit(5)`,
**Podman 5.4** (`containers/podman` tag `v5.4.0`,
`docs/source/markdown/podman-systemd.unit.5.md`, read 2026-09-24) — CT100 runs
Podman 5.4.2 (`podman --version`, measured over `ssh ct100`, read-only,
2026-09-24). `[Container]` is typed, unlike `Systemd.Unit`'s freeform
`sections`, because Quadlet's own schema — unlike bare `systemd.unit(5)` — IS
one vendor's documented, versioned surface. Adding a key later means checking
it against the same doc and adding a field; there is no raw `[Container]`
escape hatch, on purpose (see secrets, below).

```ts
PodmanContainer('grafana-primary', {
  name: 'grafana-primary',
  container: {
    containerName: 'grafana-primary',
    environmentFile: ['/etc/grafana-primary/env'],
    image: 'docker.io/grafana/grafana:12.2.1',
    network: 'host',
    volume: ['grafana-primary-data:/var/lib/grafana'],
  },
  install: { wantedBy: ['multi-user.target'] },
  service: { restart: 'always', restartSec: '5s' },
});
```

Supported `[Container]` keys: `Image`, `ContainerName`, `Network` (supports
`'host'`), `Volume` (repeatable), `EnvironmentFile` (repeatable), `Environment`
(repeatable `KEY=VALUE`, never a secret), `PublishPort` (repeatable, refused
together with `network: 'host'`), `Exec`, `User`, `AutoUpdate`
(`'registry' | 'local'`), `PodmanArgs` (repeatable). `[Unit]`
(`Description`/`Documentation` typed, everything else verbatim lines — same
approach `Systemd.Unit` uses for the whole file, because these three sections
stay systemd's own directive set even inside a `.container` file), `[Service]`
(`Restart`/`RestartSec` typed, everything else verbatim), and `[Install]`
(`WantedBy`/`RequiredBy`/`Alias` — the only three keys Quadlet honours for a
`.container` file; NOT `Also`, which plain `systemd.unit(5)` allows).

## Secrets: `EnvironmentFile=`, never `Environment=`

⛔ **A secret belongs in a host path an out-of-band renderer maintains**
(openbao-agent), named in `container.environmentFile` — never in
`container.environment`, which is rendered into a 0644 file and stored
unencrypted in Alchemy state, the same two reasons `Systemd.Unit`'s `content`
is never secret.

⚠️ **The refusal is best-effort, not a scanner** — `container-secrets.ts`. It
refuses an `Environment=` key whose NAME says what it holds (`SECRET`,
`TOKEN`, `PASSWORD`, `API_KEY`, …) and a handful of value shapes real vendor
tokens take (`Bearer `, `ghp_`, `AKIA`, a JWT's `eyJ`, …). It cannot prove a
value is safe, only refuse the obvious mistake — `container-secrets.test.ts`
proves the refusal fires before any write, and that the renderer itself has no
independent filter (validation is the only backstop, which is why every write
path calls it first).

## Lifecycle — where it differs from `Systemd.Unit`

Order is **write, `daemon-reload`, VERIFY the generator, then start or restart
the generated `<name>.service` only for a real change** — see
`container-lifecycle.ts` and `container-generator.ts` for the full reasoning,
each doc-cited. In brief:

- ⛔ **The generated unit is never `systemctl enable`d.** MEASURED on CT100,
  2026-09-24: `caddy.container` declares `[Install] WantedBy=multi-user.target`
  and nothing ever ran `systemctl enable caddy`; `systemctl is-enabled
caddy.service` prints `generated`, and
  `/run/systemd/generator/multi-user.target.wants/caddy.service` is a symlink
  the GENERATOR put there — doc-confirmed (`podman-systemd.unit(5)`): a
  generated unit is transient, and `systemctl enable` "does not work" on one;
  Quadlet applies `[Install]` itself, at every `daemon-reload`. So there is no
  `enabled` prop: declaring `install.wantedBy` **is** the enablement.
- ⛔ **A generator failure is a typed `QuadletGeneratorError`, never "absent".**
  `systemd.generator(7)` (tag `v257`): `daemon-reload` deletes ALL generator
  output and reruns every generator from the files on disk NOW. So a
  `.container` file Quadlet refuses has no generated unit at all — even one
  that generated fine a moment ago. An UPDATE that fails verification
  therefore restores the LAST-KNOWN-GOOD file and reloads again, rather than
  leaving the bad file for the next deploy to retry (`Systemd.Unit`'s own
  choice, unit-lifecycle.ts): here "the next deploy" might be a reboot, and by
  then the container this resource already promised running has no unit at
  all. A CREATE that fails removes the file it wrote, same as `Systemd.Unit`.
- ⚠️ **The one open question.** Whether an ALREADY-ACTIVE unit's `LoadState`
  stays `loaded` through a failed regeneration (systemd need not
  garbage-collect a referenced unit) was not measured — doing so needs writing
  a broken file to a live host, which read-only access forbids. If it does,
  `LoadState`/`SourcePath` alone would not catch a failed update to a
  container that was already running; the restore-last-known-good step does
  not depend on catching it, since it always leaves the host at a file known
  to generate.
- `SourcePath` (added to `systemctl.ts`'s `SHOW_PROPERTIES`, additive for
  `Systemd.Unit`) ties the generated unit back to the `.container` file —
  MEASURED on CT100: `SourcePath=/etc/containers/systemd/caddy.container`. A
  mismatch means a same-named file earlier in Quadlet's search path is
  generating the unit instead of ours — a takeover, not a success.
- Directory allowlist is Quadlet's OWN rootful search path (doc, "Podman Unit
  Search Path"): `/run/containers/systemd`, `/etc/containers/systemd`,
  `/usr/share/containers/systemd` — CT100's `caddy.container` lives in the
  middle one.
- Adopt, restart-on-change, delete (stop, remove the file, reload — no
  `disable`, since it was never enabled through systemctl) and the rename
  (delete-first replace) contract are otherwise identical to `Systemd.Unit`'s
  — see [linux-host.md](./linux-host.md).

## The CT100 fixture

`container-fixture.test.ts` renders the same directives as CT100's live
`caddy.container` (read read-only over `ssh ct100`, 2026-09-24) and checks
every line matches. Not byte-for-byte: CT100's file interleaves long prose
comments between directives, and a typed `[Container]` has nowhere to attach
"this comment goes between these two keys" — the same limit `Systemd.Unit`'s
`renderUnit` has for the identical reason. The test proves directive parity;
the file explains why byte parity is not the right bar for a typed resource.
