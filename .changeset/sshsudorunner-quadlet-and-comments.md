---
'@homeflare/alchemy': patch
---

`sshSudoRunner` now lets `Podman.Container` reach its own Quadlet-generated unit: a generated
unit's `FragmentPath` sits under a systemd generator's own output directory (`/run/systemd/generator`,
never a declared prefix), but its `SourcePath` names the `.container` file that produced it — when
that `SourcePath` is under a declared prefix, the runner elevates. Previously every generated unit
was refused outright, so `Podman.Container` could never be restarted through this runner at all.

`Systemd.Unit`'s validation now accepts leading blank lines and `#`/`;` comments before the first
`[Section]`, per `systemd.syntax(7)` — a unit file systemd already loads could still fail
`assertValid` if its first lines were comments. A genuine `key=value` line with no section still
refuses.

`Podman.Container`'s "the container's unit is NOT running" refusal message no longer asserts a
running state it does not actually know (measured false for a refusal that ran before sudo did
anything at all); it reads the unit's live state back and reports that instead.
