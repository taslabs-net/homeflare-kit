---
'@homeflare/alchemy': minor
---

New `Podman.Container` resource in `@homeflare/alchemy/linux` — one Podman Quadlet `.container`
file, declared, plus the systemd unit Podman's own generator turns it into. Built for Tim's
2026-09-24 decision that CT100's containers (the two Grafanas, shared Postgres, shared Valkey,
later TeslaMate and NetBox) are owned by Alchemy through Quadlet rather than upstream Alchemy's
`Docker.Container`, which was measured and rejected: no host-network prop (every container here
runs `--network host`), `environment` puts `Redacted` secrets in Alchemy state, and systemd
already supervises the containers.

Reuses the `Systemd.Unit` family's lifecycle machinery directly (`renderUnit`, `isUnitRunning`,
`UNIT_WRITE`, `daemonReload`/`showUnit`/`startUnit`/`stopUnit`/`restartUnit` from `systemctl.ts`,
which also gains `SourcePath` to `SHOW_PROPERTIES` — additive for `Systemd.Unit`). `[Container]`
is typed and checked against `podman-systemd.unit(5)`, Podman 5.4 (CT100 runs 5.4.2): `Image`,
`ContainerName`, `Network` (supports `'host'`), `Volume`, `EnvironmentFile`, `Environment`
(never a secret — refused by name and value shape if it looks like one, `container-secrets.ts`),
`PublishPort`, `Exec`, `User`, `AutoUpdate`, `PodmanArgs`; `[Unit]`/`[Service]`/`[Install]` mirror
`Systemd.Unit`'s verbatim-lines approach with typed conveniences for `Description`/`Documentation`,
`Restart`/`RestartSec` and `WantedBy`/`RequiredBy`/`Alias` (the only three `[Install]` keys
Quadlet honours for a `.container` file, doc-confirmed).

The lifecycle differs from `Systemd.Unit` in the one place the generator forces it to: there is
no `enabled` prop and the resource never calls `systemctl enable`/`disable` — MEASURED on CT100
(`caddy.container`) that a generated unit is transient and doc-confirmed
(`podman-systemd.unit(5)`) that `systemctl enable` does not work on one; Quadlet applies
`[Install]` itself at every `daemon-reload`. A generator failure (a `.container` file Quadlet
refuses) surfaces as a typed `QuadletGeneratorError`, never "absent" — reasoned from
`systemd.generator(7)` (`daemon-reload` deletes and regenerates ALL generator output): an UPDATE
that fails verification restores the LAST-KNOWN-GOOD file and reloads again, so a container this
resource already promised running never loses its systemd unit to a bad update, rather than
leaving the new file for the next deploy to retry the way `Systemd.Unit` does.

`container-fixture.test.ts` renders the same directives as CT100's live `caddy.container`
(read read-only over `ssh ct100`), and documents why byte-for-byte is not the right bar for a
typed `[Container]` section (CT100's file interleaves prose comments between directives, which a
typed prop has nowhere to attach). Full guide: `docs/quadlet-container.md`.

Two rounds of review before opening/landing this PR — one foreground Sonnet adversarial pass
before opening it, aimed at restart-safety and secret leakage, and one inline coordinator
review after. All three findings were real and are fixed:

- **Restart-safety, interrupted UPDATE (high).** `reconcileContainer`'s reload gate (`wrote ||
preStatus.needDaemonReload`) could not see that the SOURCE `.container` file had already been
  written by an apply that crashed before its `daemon-reload` ran: on retry, the file already held
  the new content (`wrote: false`) and the still-stale GENERATED unit hadn't changed either
  (`needDaemonReload: false`), so no reload ever happened, `settle` restarted the container onto
  its OLD definition, and state recorded the new digest as if it had taken effect — permanently and
  silently. Fixed by gating the reload on `stale` (state's digest disagreeing with what was just
  rendered) too, the same signal `changed` already used to gate the restart.
- **Restart-safety, interrupted CREATE (high, found on the coordinator's inline re-review).** The
  same bug for a resource with NO prior state: a create whose write landed but crashed before
  `daemon-reload` retried with `wrote: false` and no `stale` to disagree with either, so
  `verifyGenerated` threw on the still-missing generated unit forever — loud, but permanently
  stuck, since nothing about a plain retry ever changed any of those signals. Fixed with
  `needsVerificationReload` (`container-generator.ts`), sharing its predicate with
  `verifyGenerated` itself so the reload gate and the check it is gating can never disagree; an
  ordinary adoption whose generation was already proven fine still skips the extra reload.
- **Secret leakage (high).** `containerProblems` only ran `secretLikeEnvironment` over
  `container.environment`; `exec`, `podmanArgs` (rendered verbatim) and the `unit.lines`/
  `service.lines` escape hatches (which can spell a raw systemd `Environment=` outside the typed
  map entirely) were unchecked. Fixed with `secretLikeLines` (the same value-shape and embedded
  `KEY=VALUE` heuristics, run over every other rendered line) and an outright refusal of `-e`/
  `--env` in `podmanArgs` (`podmanArgsProblems`), both in container-secrets.ts and wired into
  `containerProblems`.

Regression tests for all three live in container-generator.test.ts ("an interrupted apply that
crashed before daemon-reload", "an interrupted CREATE that crashed before daemon-reload") and
container-secrets.test.ts (one per affected field); each was confirmed to fail without its fix.
