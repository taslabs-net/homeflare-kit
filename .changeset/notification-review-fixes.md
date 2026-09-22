---
'@homeflare/alchemy': patch
---

`Pbs.NotificationTarget` now refuses a literal credential in a plain prop, and does so at plan,
before anything is stored.

- The target refuses an `Authorization`, `Proxy-Authorization` or `Cookie` header, a header or URL
  query parameter named like `token`, `key`, `secret`, `password` or `signature`, and a password in
  the URL's userinfo. Each must be declared `{ fromEnv }` or read `{{ secrets.<name> }}`. Before
  this change, such a value planned, deployed, and stayed in the state store. A target already
  deployed that way now fails its plan until the literal is moved; the next deploy then replaces
  the stored props.
- Refusals now run in Alchemy's adoption probe as well as in `diff`. A new target used to be
  refused only in `reconcile`, after Alchemy had already committed its props to state.
- `alertmanagerAlertBody()` refuses a `generatorURL` that is not an absolute http(s) URL.
  Alertmanager rejects the whole post for one.
- Docs: `docs/pbs-alertmanager-body.md` shows the exact template text. The old block had been
  reflowed by the formatter. PVE's per-matcher read needs `Mapping.Audit` or `Mapping.Modify`;
  `Mapping.Use` is not enough.
