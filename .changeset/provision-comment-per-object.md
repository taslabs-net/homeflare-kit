---
'@homeflare/alchemy': minor
---

The provisioning baseline takes a comment per object, so it can describe a cluster that
already exists.

`provisionBaseline` and `provisionBootstrap` carried ONE `comment` for the mint group and
both mint users. That can only describe a cluster this baseline made. The common case is
the other one: a cluster that already has its mint group and its read user, each with its
own live comment, both of them already declared at those values by the stack that adopted
them. A single comment made the generated script modify all three, and the next deploy of
that stack wrote them back — a loop that reads like drift and is not. Measured on an
estate cluster on 2026-09-22, where the mint group had no comment at all and the read user
named its own mount.

`ProvisionNames` now adds `groupComment`, `provisionComment` and `readComment`, each
defaulting to `comment`, so the generic case is still one string and an override changes
exactly one object:

```ts
provisionBootstrap({
  role: 'LXCProvisioner',
  groupComment: '', // live: no comment at all
  readComment: 'mint target: read (ops)', // live: its own wording
  provisionComment: 'mint target: provision (ops)', // the one new object
});
```

The script then prints `group hf-mint: ok` and `user hf-read@pve: ok` and its only writes
are the role, the new user and its grant. A test runs exactly that against the CLI fake,
with the one-shared-comment run beside it as a negative control.

Also:

- Each comment is checked like `comment` was, and a problem is **named by where the value
  came from** — a bad shared `comment` is still one problem called `comment`, not three
  called after overrides the caller never passed.
- `readComment` goes with its lane: a `null` `readUser` drops the user, so the field is
  neither used nor checked.
- `:` joins the characters a comment may hold. It is special in neither `sh` nor a Perl
  `q{}`, and it is how real mint-user comments are written (`mint target: read`).
- `CoreProvisionNames` is the six names `PROVISION_DEFAULTS` resolves, split out so that
  type keeps its exact shape; `ProvisionNames` extends it. `ProvisionComments` is the
  resolved comment per object. Both are exported.
