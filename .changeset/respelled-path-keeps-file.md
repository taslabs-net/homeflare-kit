---
'@homeflare/alchemy': patch
---

A `HostFile` or `ReleaseBinary` whose path is respelled to the same file — through a symlinked parent such as `/etc` and `/private/etc`, or by case alone on case-insensitive APFS — is now planned as an `update` that keeps the file. Before, it was planned as a `replace` whose cleanup deleted the old path, which was the same file: the deploy succeeded and the file was gone until the next one. `HostRunner.stat` may now report `dev` and `ino` (the local runner does); a runner that does not gets a check after the move, so a lost file fails the deploy instead. A create whose read-back throws (not only one that mismatches) is now removed. `ReleaseBinary` also refuses a mode its owner cannot read, and a directory that group or other may write. It refuses, too, a second resource installing the same path in one deploy: two owners of one file meant that dropping either one deleted the file the other still declared.
