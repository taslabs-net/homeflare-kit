---
'@homeflare/alchemy': patch
---

Host.Directory on macOS no longer passes `--` to chmod and chown. Those BSD tools treat that token as a filename, so a first deploy created the directory and then failed the resource. Linux still passes `--`, which the sudo allowlist requires. mkdir and rmdir are unchanged.

The archive inflater's source stream is typed as the chunk type DecompressionStream accepts, so the package typechecks under TypeScript 7. The bytes are unchanged.
