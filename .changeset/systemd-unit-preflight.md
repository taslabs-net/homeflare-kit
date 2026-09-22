---
'@homeflare/alchemy': patch
---

Check a systemd rename at plan time. A unit's name or directory change is a delete-first replace, and Alchemy deletes the old unit before reconciling the new one, so a masked name, a unit file someone else owns, or a runner that will not write the new path used to be noticed only after the old unit was already stopped. Those checks now run while planning, and again at apply when the new name was still an Output and the diff could not see the rename. A file byte-identical to this declaration's render stays exempt: it is a deploy that died between write and reload.
