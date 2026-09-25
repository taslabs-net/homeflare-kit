---
'@homeflare/alchemy': patch
---

`Podman.Container` no longer reads as an existing (and therefore "adopted") resource when its
`.container` file is absent but a PLAIN unit — never Quadlet's own generator output — already
answers to the same service name. The read now refuses at plan time, naming the shadowing unit
file and the fix (move it aside before declaring the container), instead of a create silently
becoming an "adopted" plan that would only fail `verifyGenerated` mid-apply, after other resources
in the same plan had already written.
