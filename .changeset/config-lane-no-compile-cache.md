---
'@homeflare/config': patch
---

Pre-push lanes run with `NODE_DISABLE_COMPILE_CACHE=1`: npm enables Node's module compile cache at
startup, which left `node-compile-cache` in the temp guard's `TMPDIR` and made it refuse every push
of an npm repo for a directory its tests never created. The guard is otherwise unchanged.
