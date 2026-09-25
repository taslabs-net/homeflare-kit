---
'@homeflare/alchemy': patch
---

Fix two regressions from the distilled transport migration: ReplicationJob reads no
longer fail closed when a SectionConfig release echoes guest/jobnum as text instead
of a JSON number, and lxcTask's poll loop no longer aborts a still-running task on a
status word other than exactly "running"/"stopped".
