---
'@homeflare/alchemy': patch
---

`@homeflare/alchemy/linux` now re-exports `renderContainerFile` and `containerPathFor` from
`Podman.Container`'s pure `.container` file renderer — the same kind of pure helper `renderUnit`/
`DEFAULT_UNIT_DIRECTORY` already are for `Systemd.Unit`. A consumer proving its own declared
props render into the directive set it expects (an equivalence/fixture test against a live host)
previously had no import path to the real renderer and had to reimplement the render contract by
hand to write that test at all (found: homeflare-ct100 PR #1).
