---
'@homeflare/alchemy': patch
---

`Podman.Container` no longer reads as an existing (and therefore "adopted") resource when its
`.container` file is absent but a PLAIN unit that genuinely outranks Quadlet's generator in
systemd's unit load path — `/etc/systemd/system` chief among them, never a vendor directory like
`/usr/lib/systemd/system`, which is lower precedence than the generator and not a real shadow —
already answers to the same service name. The read now refuses at plan time, naming the shadowing
unit file and the fix (move it aside before declaring the container), instead of a create silently
becoming an "adopted" plan whose eventual apply would leave the pre-existing plain unit running
untouched while state recorded attributes read back from it. `verifyGenerated` is also hardened to
check the same fact as a backstop at apply time, for the case this plan-time check does not cover.
