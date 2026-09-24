# Alchemy changelog archive 16

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

- [#83](https://github.com/taslabs-net/homeflare-kit/pull/83) [`01c54cf`](https://github.com/taslabs-net/homeflare-kit/commit/01c54cfcf3892388369e4c01765ca5f69d843e8b) Thanks [@taslabs-net](https://github.com/taslabs-net)! - **New: `hf-adopt-verify` and `@homeflare/alchemy/verify` — prove a deploy's adoptions are no-ops
  before it runs.** Alchemy prints `adopted` for an object that already matches and for one that
  drifts alike (beta.79 `Plan.ts` turns the diff's `noop` into an update after the adoption probe),
  and the deploy reconciles both. The verifier plans the stack with Alchemy's own planner, with
  every provider watched and every write path refused. For each row without a state row it reports
  the provider's `read`, its own `diff` before the engine forced it, and the declared fields that
  differ (names only). It exits `0` only when all are no-ops, `1` when any is not, `2` when the plan
  could not be computed.

  ```sh
  bunx --bun hf-adopt-verify --config alchemy.run.ts --stage live [--all] [--json]
  ```

  `verifyStack(target)` and `verifySession({ stack, context })` are the same thing as functions.

  **Fix: adopting a `Proxmox.CephPool` that already matches no longer writes.** Its reconcile PUT
  `setpool` whenever the pool existed, so every adoption forked a `cephsetpool` worker under the
  provision token. On TB4 that was six tasks, one per pool, on 2026-09-13 and 2026-09-20. It now
  skips the PUT when its own `matches` holds, like every other PVE/PBS family. The predicate is
  shared in one place (`update-guard.ts`). `docs/adopted-deploys.md` traces what a deploy of an
  adopted row does for every family the Proxmox and PBS stacks use.

- [#80](https://github.com/taslabs-net/homeflare-kit/pull/80) [`66d9374`](https://github.com/taslabs-net/homeflare-kit/commit/66d937416287b8b657da4091eecdd3824666087a) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `@homeflare/alchemy/proxmox` now exports `ProxmoxLxc` as a Resource. It declares a Proxmox VE container: you can adopt one that runs today, or create one from a template.

  - **The props are PVE's own keys and spellings**, taken from `/nodes/{node}/lxc/{vmid}/config`: `hostname`, `cores`, `memory`, `swap`, `rootfs`, `mpN`, `netN`, `devN`, `features`, `unprivileged`, `onboot`, `startup`, `description`, `tags`, and the rest. To adopt a guest, paste its `pvesh get` output. An undeclared key is unmanaged. A key declared as `''` is removed, where PVE allows that. `password`, `ssh-public-keys` and `env` are typed `never`.
  - **Values are compared as PVE stores them.** Key order and written-out defaults are ignored. A MAC PVE generated is ignored, and a NIC write keeps the live MAC. `storage:GiB` equals the volume it allocated. An existing volume is always written back with its live volume id.
  - **Changes are made in place.** Config changes use one `PUT …/config` carrying the config `digest`. A larger disk uses `PUT …/resize`. Create, resize and delete wait for their PVE task. If nothing differs, nothing is written, including on the first deploy after an adoption.
  - **Nothing plans a replace.** These changes fail the plan with a sentence, and nothing is written: a new `vmid`, a `node` the guest is not on, another `ostemplate`, an `unprivileged` flip, a smaller disk, another storage, or detaching a mount point.
  - **Keys only root@pam can write are refused at plan.** These are `devN`, bind or device mounts, features other than `nesting`, and any feature on a privileged guest. PVE never treats an API token as `root@pam`, so the refusal prints the `pct set` to run on the node instead.
  - **A read failure is not "absent".** A config read counts as absent only when it answers 500 and the cluster lists the vmid nowhere. Any other failure fails the plan. A vmid held by another node, or by a QEMU VM, fails the plan and says where it is. After HA or `pct migrate` has moved a guest, setting `node` to where it is now is an update that writes nothing.
  - **Nothing is adopted without `adopt(true)` or `--adopt`, not even a guest that matches the declaration.** This is the rule of `docs/ownership.md`, which every `Bao.*` family, `HostFile` and `LaunchdJob` follow. Matching is not proof of ownership: once state claims a guest, `RemovalPolicy.destroy()` deletes it and its volumes. Without adoption on, the plan fails with "Cannot adopt". A create interrupted after its POST still resumes without `--adopt` when the guest matches what it declared.
  - **An adoption's plan always says `adopted`.** Alchemy prints no diff for it, so a warning names each key a deploy would write.
  - **A create only ever allocates.** A create naming an existing volume id (rather than `storage:GiB`) is refused, because PVE would unpack the template onto that volume; so is any key the resource does not manage. A deploy that planned a create never takes over a guest it then finds at that vmid. Without adoption on, it fails and forgets its `creating` row. With it on, a matching guest is recorded with no write and any other is refused. A guest the cluster lost while state still holds it plans `update` with a warning that the deploy creates it again, or fails the plan when it cannot be created.
  - **State keeps managed keys only.** The `config` attribute is an allowlist, so a key a newer PVE adds (such as `entrypoint`) is not stored.
  - **It retains by default.** Dropping the declaration leaves the guest running. Only `RemovalPolicy.destroy()` deletes it, only while the guest still matches its last declaration, and it never forces the delete or stops the guest first.

  Breaking, for anyone who deep-imported the old provider-only version: `storage` is gone (declare `rootfs: 'storage:GiB'`), `ostemplate` is optional, the attributes are now `{ node, vmid, config, rawKeys }`, and `hostname` no longer defaults to `ct<vmid>`. The guide is `docs/proxmox-lxc.md`.

### Patch Changes

- [#82](https://github.com/taslabs-net/homeflare-kit/pull/82) [`462368f`](https://github.com/taslabs-net/homeflare-kit/commit/462368fa263ef541bac7c0e70070fb656b4fcda7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The ownership and `ProxmoxLxc` guides now say how to read an adoption's plan before it writes. `alchemy plan` has no `--adopt` flag in alchemy 2.0.0-beta.79, so without adoption on it stops at "Cannot adopt" before any resource can warn what taking the object over would write. Run `alchemy deploy --adopt --dry-run` instead, or declare `.pipe(adopt(true))` and run `alchemy plan`. The LXC guide also warns that a drift warning does not stop the deploy: `deploy --adopt --yes` writes a `net0` declared without the live `tag=` without it, and the guest leaves its VLAN.

## 0.9.0

> ⚠️ Never published: no npm version and no git tag. These changes first shipped in 0.10.0.

### Minor Changes

- [#78](https://github.com/taslabs-net/homeflare-kit/pull/78) [`8de1015`](https://github.com/taslabs-net/homeflare-kit/commit/8de1015993f147ffb2f88116204cba6efb449268) Thanks [@taslabs-net](https://github.com/taslabs-net)! - ⚠️ **BEHAVIOUR CHANGE — `@homeflare/alchemy/openbao` no longer adopts anything silently.** Until
  0.8.0, every `Bao.*` family adopted a live object it had no state for: a new declaration of a
  policy, role, mount, auth method, plugin or MFA object that already existed was taken over, and
  rewritten, without being asked. **A stack that relied on that must now add `adopt(true)` to those
  resources, or deploy once with `--adopt`.** Otherwise its next plan fails with
  `OwnedBySomeoneElse` ("Cannot adopt resource … Re-run with `--adopt`").

  - **Every `Bao.*` family (all 14).** With no state row, a live object reads as `Unowned`, even when it
    is identical to the declaration. Identical is not proof of ownership: under `destroy`, the old
    owner's delete would remove the object the new declaration had just claimed. The plan fails
    unless adoption is on. This is the rule `HostFile`, `LaunchdJob` and `CaddyConfig` already
    follow. The 0.8.0 swap (a new logical id for a live name, then the old id's delete) now fails the
    plan and writes nothing.
  - **Crash recovery still works without `--adopt`.** Alchemy's recovery read for an interrupted
    create carries that row's own instance id, and the object is ours when it also matches the row's
    props. An interrupted replace resumes through a note that its `diff` leaves for the apply. A
    create interrupted between two writes (a mount enabled but not tuned) is not proven ours, so it
    needs `--adopt`.
  - **The same check at apply.** Alchemy skips the probe while a prop is still an Output, and never
    probes the new generation of a replace. Each family's `reconcile` now reads the object first and
    refuses the takeover before any write, unless `--adopt` or the resource's own `adopt(…)` allows
    it, resolved as the planner resolves it. A refused create also forgets the `creating` row Apply
    wrote, so the next plan does not adopt what the apply refused. A `BaoMount` / `BaoAuthMethod`
    create with `remountFrom` refuses to move a live mount the stack holds no state for.
  - **`HostFile` and `LaunchdJob`: `--adopt` now works at apply.** Their `reconcile` refused a
    foreign file or job even under `--adopt`, where the probe had been skipped. A create now takes it
    over when adoption is on. `adopt(false)` still wins over the flag. A rename onto an occupied
    path or label stays refused.
  - **`sudoRunner()` refuses more, before sudo** (⚠️ a declaration that 0.8.0 accepted can now fail):
    - a root-owned file under a prefix that would be group- or world-writable, setuid or setgid
      (`mode & 0o6022`; an omitted owner is root);
    - any directory between the prefix and the file that root does not own, or that group or other
      may write. Before, only the prefix itself was checked.
    - A `HostFile` or `LaunchdJob` plan that will write now runs these checks too, through the new
      optional `HostRunner.checkWrite`, so the refusal fails the plan instead of the apply. It only
      reads, as the operator: a plan still never calls sudo.

  New: `docs/ownership.md` (the rule, where it is checked, recovery, limits). `docs/launchd-sudo.md`,
  `docs/launchd.md` and the openbao README and REPLACE.md are updated.

## 0.8.0

### Minor Changes

- [#74](https://github.com/taslabs-net/homeflare-kit/pull/74) [`cd6d437`](https://github.com/taslabs-net/homeflare-kit/commit/cd6d437c134ca726a6d6ca5b28053ed01a2762e6) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Rename safety for the other nine name- or catalog-keyed families in `@homeflare/alchemy/openbao`: `BaoAuthRole`, `BaoPkiRole`, `BaoJwtRole`, `BaoKubernetesRole`, `BaoJwtAuthConfig`, `BaoMfaTotpMethod`, `BaoMfaLoginEnforcement`, `BaoSshRole` and `BaoPlugin`. They now get the same checks as `BaoPolicy`, `BaoCloudflareRole` and `BaoProxmoxRole`, through one shared helper.

  Behaviour changes:

  - A rename or move onto a name, path or catalog entry that already exists now fails the plan, before anything is written. Before, two roles that swapped names under `RemovalPolicy.destroy()` both planned `replace`, and a green deploy deleted both of them. This happened for `BaoAuthRole`, `BaoPkiRole`, `BaoJwtRole`, `BaoKubernetesRole`, `BaoSshRole` and `BaoPlugin`. It also applies under `retain`: a swap now takes two deploys through a free name. For `BaoPlugin` it includes a version bump onto a version already registered by hand. For `BaoJwtAuthConfig` it includes a move onto a mount whose config is already set.
  - The name or mount is now checked while other props are still pending Outputs. Before, a rename in the same deploy as any pending Output planned `update`, and the old object stayed live with no state record. For `BaoMfaTotpMethod` that wrote a second method. Its rename is now refused at plan in that case too.
  - When the name itself is an Output not known until apply, reconcile now refuses the `update` before writing anything. The next deploy plans `replace`, or, for `BaoMfaTotpMethod`, refuses the rename.
  - `BaoKubernetesRole` and `BaoJwtRole` compare names lowercased, as OpenBao keys them, so a change of case is not a move. Both still refuse an upper-case name.
  - `hostAppRoles` now lets a host sit in several classes, with one role per class. It only refuses the same host listed twice in one class. Before, any host listed twice was refused.
  - `hostAppRoles` refuses a host whose class names an inherited object key such as `constructor`. Before, that host passed as a class with no policies and no `secretIdTtl`, and got a role whose secret_id never expires.

  Documentation: a new logical id for a name that is already live adopts it, and under `RemovalPolicy.destroy()` the old id's delete then removes it, in a green deploy. Change a logical id with Alchemy's `renamedFrom`, and take a name another resource is leaving in the deploy after the move (REPLACE.md). Also: deleting an AppRole role does not revoke the tokens it issued. OpenBao 2.6.2 deletes the role's secret_ids and role_id, so no new login succeeds, but issued tokens live to their TTL and only fail to renew. The `BaoAuthRole` comments said the delete revoked every token.

- [#75](https://github.com/taslabs-net/homeflare-kit/pull/75) [`85dd10c`](https://github.com/taslabs-net/homeflare-kit/commit/85dd10cd3fb16e9daf48592d21340449fb381b56) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `CaddyConfig` in `@homeflare/alchemy/caddy` no longer adopts a running Caddy silently. In 0.7.0, the first read adopted whatever config a Caddy was running, and the next apply loaded over it.

  Behaviour changes:

  - With no state, the first read is Alchemy's adoption probe. A Caddy whose running config is the declared one is adopted as-is, and nothing is loaded. A Caddy serving nothing (`null`, or no apps) plans a create. Any other config reads as `Unowned`, so the plan refuses it unless the deploy runs with `--adopt`. A Caddyfile that cannot be compared at probe time also reads as `Unowned`, with a warning saying why, never an error: the engine replays this read to recover an interrupted create, and an error would fail every later plan.
  - Where Alchemy skips that probe (props holding an Output, as on `caddyWithFile()`'s first deploy), the apply refuses the same takeover before any `/load` (the HostFile is written by then). It resolves adoption as the planner does: the resource's own `adopt(…)`, else `--adopt`. So `.pipe(adopt(false))` still refuses under `--adopt`, and `.pipe(adopt(true))` takes over without it.
  - The state vouches only for the Caddy it was applied to. When the transport now reaches a Caddy at another endpoint, the apply needs adoption (`--adopt`, or the resource's `adopt(true)`) unless that Caddy runs the config the state last stored, the declared one, or nothing.

  Docs: `docs/caddy.md` has the adoption table, and records that managed Caddies run `caddy run --resume` with their own `XDG_CONFIG_HOME`, set in the launchd job rather than the envfile. A restart then runs the last config Caddy accepted, and after a resumed start SIGUSR1 has no file to reload. The admin endpoint section moves to `docs/caddy-admin.md`, and the README's reasons for each peer and override pin move to `docs/peers.md`.

- [#77](https://github.com/taslabs-net/homeflare-kit/pull/77) [`9ec684c`](https://github.com/taslabs-net/homeflare-kit/commit/9ec684c612c5d9c0987b4e9ca462e1f683bf954e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `sudoRunner()` to `@homeflare/alchemy/launchd`, so a host stack can deploy as the operator
  instead of as root.

  - **Only the calls that need root use `sudo -n`, in fixed argv shapes.** These are
    `launchctl bootstrap | bootout | kickstart` in the system domain, and `install` / `rm` of a file
    under a prefix the stack declares. A file is written as the operator to a private `0600` temp
    file, then copied into place with `install -S -m <mode> -o <uid> -g <gid>`. Nothing else runs
    as root, and a plan never calls sudo.
  - **It is opt-in:** `launchdProviders(sudoRunner({ prefixes }))`. `localRunner()` stays the
    default and never elevates, and nothing falls back to sudo.
  - **It never prompts.** A password-required `sudo -n` fails at once with `SudoRefusedError`, and
    the message says to run `sudo -v` or to grant exactly these commands `NOPASSWD`.
  - **Each privileged argv is logged before it runs.** The log holds the argv only, never file
    content.
  - **These are refused before sudo is asked, with `SudoRefusedError`:** any argv outside the
    allowlist (such as a bare `bootout system`, a directory `bootstrap`, or a plist anywhere but
    `/Library/LaunchDaemons/<label>.plist`), a system `bootstrap` / `bootout` without
    `/Library/LaunchDaemons` among the prefixes, a prefix that is not a real directory only root may
    write, a path outside every prefix that needs root, a symlink between the prefix and the file, a
    file the operator could not read back, and another user's `gui/<uid>` domain.

  `docs/launchd-sudo.md` has the full list, the sudoers cautions, and the limits.

## 0.7.0

### Minor Changes

- [#72](https://github.com/taslabs-net/homeflare-kit/pull/72) [`294518d`](https://github.com/taslabs-net/homeflare-kit/commit/294518dc205c1981bf8f48aaf087bdb3869d4123) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Rename safety for `BaoPolicy`, `BaoCloudflareRole` and `BaoProxmoxRole` in `@homeflare/alchemy/openbao`.

  Behaviour changes:

  - A changed `name` on `BaoPolicy`, or a changed `mount` or `name` on `BaoCloudflareRole` or `BaoProxmoxRole`, now plans `replace`. Before, it planned `update`: the new object was written and the old one stayed live with no state record, even under `RemovalPolicy.destroy()`. Now the old one is deleted after the new one is written, or kept under the default `retain`, and the apply says so.
  - `BaoPolicy` compares names the way OpenBao stores them, trimmed and lowercased, so a change of case is not a rename.
  - A `BaoProxmoxRole` rename that also changes `mintUser` now fails the plan unless `allowMintUserChange` names the old mint user, the same rule an in-place re-scope already had.
  - A rename or move onto a name or path that already exists live now fails the plan, before anything is written. Without this, two policies or roles that swapped names under `RemovalPolicy.destroy()` both planned `replace` and ended with both deleted. The check also applies under `retain`, because a diff cannot see the removal policy: a swap, or a move back onto a retained old generation, now takes two deploys through a free name, or removing the target by hand.
  - When the new name is an Output that is not known until apply, reconcile now refuses the `update` before writing anything. The next deploy plans `replace`. A `BaoProxmoxRole` rename whose `allowMintUserChange` is still an Output defers the same way instead of failing the plan.

  The rename is checked even while other props are still pending Outputs. `src/openbao/REPLACE.md` has the measured engine behaviour and what `retain` leaves live for each of the three.

- [#70](https://github.com/taslabs-net/homeflare-kit/pull/70) [`8cafb48`](https://github.com/taslabs-net/homeflare-kit/commit/8cafb48d84a9734997d7562311801025f2fa4236) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add the `@homeflare/alchemy/caddy` subpath: a running Caddy's config, declared as Caddyfile text and applied through Caddy's own admin API.

  - `CaddyConfig` / `CaddyConfigProvider` (`Caddy.Config`): the whole Caddyfile as one prop. Apply is `POST /adapt` (validate), `POST /load` with `text/caddyfile` (graceful reload), then `GET /config/`, which must hash to the adapted config, or the deploy fails. When Caddy refuses a config, it keeps the old one, and the error gives Caddy's reason and confirms whether the old config is still running. This includes Caddy's refusal that arrives in a 200 response after adapter warnings. Drift compares SHA-256 digests of canonical adapted JSON: declared, live and stored. A hand edit or a restart with a different file plans an update. A plan-time `/adapt` fails the plan on a bad Caddyfile. With no state, a running Caddy is adopted. `replace` is never planned. Delete never unloads or stops Caddy, and `retain` is the default.
  - `caddyWithFile()`: the same Caddyfile is also written with launchd's `HostFile` to the file Caddy starts from, so a restart keeps it. The file is written first, then `/load`, and both are retained. `sourceFile` is sent as `Caddy-Config-Source-File` so SIGUSR1 reload-from-file keeps working. `docs/caddy.md` covers the order, `--resume`/autosave and the refused-config window.
  - `CaddyAdmin`, `localCaddyAdmin()`, `caddyAdminLayer()` and `caddyProviders()`: every admin call goes through one injectable transport. The local transport uses `node:http` on both Bun and Node, accepts only loopback `http://` or `unix://`, and sends `Host`/`Origin` the way the Caddy CLI does. `hostHeader` covers narrowed `origins` and SSH-forwarded ports. It retries only refused connections and then rejects with `CaddyUnreachableError`. A stopped Caddy does not fail the plan, because its launchd job may be the fix: read and diff plan the load with a warning, and the apply fails until Caddy answers.
  - Refused before anything is sent: an empty Caddyfile or one that adapts to no apps; literal secrets (a PEM key, a literal after `dns <provider>`, secret-named subdirectives, literal `Authorization` headers, token and password-hash shapes, and a `{$NAME:default}` whose default is one of these); and an adapted `admin` block that would turn the API off, move it off loopback or away from the transport (another port, socket or loopback address, or no address at all when the transport is not at Caddy's default), allow no Host the transport sends, set `enforce_origin` over a unix socket, enable `remote`, or pull config. Secrets go in `{env.NAME}` or `{file./path}` placeholders.

- [#71](https://github.com/taslabs-net/homeflare-kit/pull/71) [`73736ae`](https://github.com/taslabs-net/homeflare-kit/commit/73736aec0a686af36cb4ef7ecfba42d40e543fc7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `MeshNode` (`Cloudflare.MeshNode`) and `fetchMeshNodeToken` to `@homeflare/alchemy/cloudflare`.

  - **`MeshNode`** declares a Cloudflare Mesh node (a `warp_connector`) with `name` and `ha`. It never reads the node token, so the token never reaches Alchemy state. Alchemy's `Cloudflare.Tunnel.WarpConnector` fetches it on every read and stores it, and it has no `ha`. The attributes are `id`, `accountId`, `name`, `status` and `ha`.
    - A `name` change renames the node in place (`PATCH`), keeping its id, token and enrolled replicas.
    - `ha` is required and create-only (Cloudflare: "cannot be changed afterward"). A change replaces the node: delete-first while the name stays (names are unique per account), create-first when the name changes too. An account change is a create-first replace.
    - **It defaults to `RemovalPolicy.retain`**, like the kit's other resources whose deletion breaks their consumers: deleting a node cuts every enrolled replica off the Mesh, and a new one means a new token and Mesh IPs. Dropping the declaration or `alchemy destroy` leaves the node live. Opt in with `.pipe(RemovalPolicy.destroy())`.
    - Under that default a same-name `ha` change **refuses and writes nothing**: the engine keeps the old node, which still holds the name, and a create never reuses a node it did not create (that would record the wrong `ha`). The sentence names the ways on: deploy once with `.pipe(RemovalPolicy.destroy())` (delete-first), delete the old node by hand, or keep it (`alchemy state rm` the row, then `adopt(true)`; reverting `ha` alone refuses again). A create-first replace leaves the old node live. When a create-first replace's new name is already held by another node, the sentence does not call it the old node and says not to delete it. Every way back from inside a replace starts with `alchemy state rm`, because `adopt(true)` alone does not act on a `replacing` row; the 1013-retry sentence says so too. All measured through Alchemy's real plan/apply against the fake.
    - A door (a node with no routes) is documented as `ha: false`: HA fails over routes, and each replica has its own Mesh IP. A second door is a second `MeshNode`.
    - An existing node is adopted by exact name and returned `Unowned`. A create answered code 1013 after a clean lookup (distilled retries a create whose response was lost) names the node that appeared rather than blaming another tunnel type.
    - `list` is empty and `nuke` skips the type, because Alchemy's WarpConnector already lists every `warp_connector`.
  - **`fetchMeshNodeToken({ accountId, id | name })`** returns the node token `Redacted`, on demand, for a one-off enrolment step. Callers write it to a root-owned `0600` file on the node and nowhere else. An empty token fails, and a 403 names the Write permission the endpoint needs. Before any request it refuses the Global API Key, an empty API token, and a set `DISTILLED_DEBUG_HTTP` (distilled would print the token to stderr).
  - Built on `@distilled.cloud/cloudflare`, the SDK Alchemy's own Cloudflare providers use. The `cloudflare@4.5.0` SDK cannot create an HA node. It is a new **required peer**, pinned to the version alchemy pins (`1.0.0-rc.12`): add it to your install line.
  - `providers()` now also resolves Alchemy's Cloudflare credentials and account for `MeshNode`, the same way `Cloudflare.providers()` does (a profile, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

  Guide: `docs/mesh-node.md`.

## 0.6.0
