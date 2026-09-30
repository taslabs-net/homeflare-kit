# Valkey — `@homeflare/alchemy/valkey`

Two resources for the seat-wiring data plane (seat-wiring-spec §5), built 2026-09-29, walked
against Valkey 8.1.10 (the image already pinned on CT100) and 9.1.1 (the scratch instance used to
prove the ACL rules). There is no `@distilled.cloud/valkey` package (registry 404, checked
2026-09-29) and `effect` ships no Valkey/Redis client, so this family hand-rolls the handful of
RESP commands it issues (`INFO`, `CONFIG GET`, `ACL LIST`, `ACL SETUSER`, `ACL DELUSER`, `AUTH`,
`PING`) over `node:net` — see `src/valkey/transport.ts`.

- `Valkey.Instance` — **assert-and-read** a running server. It never creates, never reconfigures,
  and never stops one.
- `Valkey.AclFile` — the per-instance **ACL users**, each limited to a key prefix and a fixed
  command allow-list, with passwords by reference (never in state).

Both are `defaultRemovalPolicy: 'retain'` and answer `Unowned` on read (H1), so a live instance and
its ACL each need `adopt(true)` in the stack that declares them.

## `Valkey.Instance`: assert, never mutate

The instance itself is a container the `Podman.Container` family owns — CT100's two dormant
Quadlets live in `homeflare-ct100/src/valkey.ts`. This resource reads `INFO` and `CONFIG GET` and
refuses drift; it never issues `CONFIG SET` (which could drop in-flight data) and never starts a
process. `delete` raises `ValkeyInstanceDeleteRefused` and, independently, `defaultRemovalPolicy`
is `retain` — two reasons the engine never shuts a server down through this provider.

```ts
import { ValkeyInstance } from '@homeflare/alchemy/valkey';

export class Seats extends ValkeyInstance('Seats', {
  name: 'valkey-seats', // the Quadlet's containerName
  port: 6381,
  maxmemory: '512mb',
  maxmemoryPolicy: 'noeviction',
  appendonly: 'yes',
}) {}
```

Asserted props are `port`, `maxmemory`, `maxmemoryPolicy`, `appendonly`; omitted props are not
checked. `diff` reports an update on the first drift; `reconcile` re-reads and raises
`ValkeyInstanceDrift` naming the prop. The version line (`redis_version:` in `INFO`) is read into
attributes but never asserted.

## `Valkey.AclFile`: seat users, key-prefix scoped

One `Valkey.AclFile` per instance, holding **every non-default user** that instance has. The
header comment in `src/valkey/acl.ts` states the constraint: a shared file would let a seat user
exist on the LiteLLM cache (`:6380`) and `litellm` on the seat store (`:6381`) — every seat could
poison the response cache. `valkey-seats` carries the seat users; `valkey-litellm` carries the
single `litellm` user.

```ts
import { ValkeyAclFile } from '@homeflare/alchemy/valkey';

export class SeatsAcl extends ValkeyAclFile('SeatsAcl', {
  instance: 'valkey-seats',
  users: {
    claude: {
      name: 'claude',
      keyPrefix: 'claude:*',
      profile: 'seat',
      password: { fromEnv: 'VALKEY_CLAUDE_PW' },
    },
    grok: {
      name: 'grok',
      keyPrefix: 'grok:*',
      profile: 'seat',
      password: { fromEnv: 'VALKEY_GROK_PW' },
    },
  },
}) {}
```

- **Password by reference (S25).** `password` is `{ fromEnv }`; the value exists only in the
  deploying process's memory and on the wire. State stores a scrypt **seal** so the next plan can
  tell whether the value changed, without holding anything a reader could send to Valkey.
- **The key prefix is the isolation.** `~claude:*` limits a seat to its own keyspace — the
  pattern `homeflare-ct100/src/valkey-acl.ts` already renders (`~${user}:*`) — and
  `resetchannels` plus `&<user>:*` limits pub/sub to its own channels (a `service` profile gets
  `allchannels` instead — the one consumer that owns a whole instance). A seat whose
  `keyPrefix` is not `<name>:*` is refused before any write (`ValkeyAclSeatKeyPrefix`); `*`
  is a `service` pattern only. A seat gets `WRITE` only where its job writes.
- **Fixed command allow-list, not a prop.** A seat gets `+@read +@write` plus the data-type
  categories, and is denied `-@dangerous -@admin` plus the keyless/admin commands
  (`-keys -flushall -flushdb -monitor -acl -config -shutdown -debug`) and
  `-scan -randomkey -dbsize -pubsub` (keyspace/channel enumeration). This mirrors
  `homeflare-ct100/src/valkey-acl.ts`'s `SEAT_COMMANDS`; it is not a per-declaration surface
  because widening it would let a seat request `FLUSHALL` or `ACL SETUSER`.
- **Reconcile re-reads (S10).** After `ACL SETUSER`/`ACL DELUSER`, it reads `ACL LIST` back and
  fails `ValkeyAclReadbackFailed` if a declared user's prefix is wrong or an undeclared user
  remains. `delete` removes every declared user (the engine runs it only when a human opts out of
  retain); the instance is untouched.

## Connection

`valkeyProviders({ host, port, username, password })` wires both resources to one instance; a stack
with more than one instance calls it more than once and merges the results. `host`/`port` carry no
secret; `password` is a `FromEnv` reference resolved at call time (a missing variable is the typed
`ValkeyAuthPasswordMissing`, and a username without a password is unrepresentable). `withValkey`
opens one `node:net` socket per operation and closes it after — never held across a whole
reconcile. Connect, each read, and the socket idle timer share `timeoutMs` (default 10s); a
reply longer than 1 MiB or an array longer than 10,000 elements fails `ValkeySocketError`.

```ts
import { valkeyProviders } from '@homeflare/alchemy/valkey';

const providers = valkeyProviders({
  host: '127.0.0.1',
  port: 6381,
  username: 'admin',
  password: { fromEnv: 'VALKEY_ADMIN_PW' },
});
```

⛔ **The admin user is a prerequisite, not something this kit creates.** No user a fresh
`--aclfile` instance starts with can run `ACL SETUSER`: a `seat` user is denied `-acl`, a
`service` user is denied `-@dangerous` (which contains the ACL commands), and the rendered ACL
files ship `user default off`. Before the kit's first reconcile of an instance, the orchestrator
must put one admin user into that instance's ACL file — `user admin on ><pw> ~* +@all` — and pass
its name and password to `valkeyProviders`. This family never manages that user: the connection's
own username is skipped by name in every `ACL LIST` read (read, plan, and the reconcile's
read-back), so a reconcile never removes an undeclared admin. Declaring that name, or `default`,
is refused before any write (`ValkeyAclReservedUser`): `ACL SETUSER` `reset` would replace
`~* +@all` and the next `ACL LIST` would answer `NOPERM`.

## Activating the two dormant Quadlets

The containers are declared `started: false` in `homeflare-ct100/src/valkey.ts`; this kit only
declares the resources. The orchestrator's activation order, in the order each step depends on:

1. **Secrets in OpenBao.** `kv/data/apps/valkey/seats` with fields `claude_password`,
   `claude2_password`, `grok_password`, `cf_harness_password`; `kv/data/apps/valkey/litellm` with
   `litellm_password`. (Rendered by openbao-agent fragments/95 and 96 — the templates in
   `homeflare-ct100/src/valkey-acl.ts`.)
2. **ACL files.** openbao-agent renders `VALKEY_SEATS_ACL_PATH` (`/etc/valkey/seats-acl.conf`) and
   `VALKEY_LITELLM_ACL_PATH` (`/etc/valkey/litellm-acl.conf`); each container bind-mounts its own
   file read-only as `--aclfile`. Both start with `user default off` — no keyless access.
3. **First proof command**, after the Quadlets are started (`systemctl --user start
valkey-seats.service valkey-litellm.service`):

   ```sh
   valkey-cli -h 127.0.0.1 -p 6381 --user claude --pass "$VALKEY_CLAUDE_PW" PING
   # -> PONG, and a write outside the prefix is refused:
   valkey-cli -h 127.0.0.1 -p 6381 --user claude --pass "$VALKEY_CLAUDE_PW" SET grok:x 1
   # -> (error) NOPERM this user has no permissions to access one of the keys used as arguments
   ```

   The `default off` line means the same `PING` without `--user` answers
   `(error) NOAUTH Authentication required.`

## Version

Valkey 8.1.10 (CT100's pinned image, `VALKEY_VERSION`) and 9.1.1 (scratch proof). The ACL rules —
`-scan -randomkey -dbsize -pubsub` closing keyspace/channel enumeration, and `resetchannels` as
the pub/sub boundary — were measured on both (seat-wiring-spec §5).
