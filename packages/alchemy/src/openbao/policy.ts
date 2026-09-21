import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Path from 'effect/Path';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { refuseTakeover } from '../ownership/adopt.ts';
import { ownedRead } from '../ownership/probe.ts';
import { noteResume } from '../ownership/resume.ts';
import { sha256 } from './digest.ts';
import { isEmptyAssembly } from './policy-assembly.ts';
import { deletePolicy, policyPath, readPolicy, writePolicy } from './policy-wire.ts';
import { policyKey } from './rename.ts';
import { guardRename, judgeRename, nameIdentity } from './rename-identity.ts';

/**
 * An OpenBao ACL policy, assembled from the HCL fragments that declare it.
 *
 * ★ WHY THIS EXISTS. The estate already hand-rolled both halves of what Alchemy provides:
 *   five `apply-*.sh`/`apply-*.py` scripts converge OpenBao, and separate `check-*.sh`
 *   gates compare live to repo and refuse on drift. That is `reconcile` and `diff` written
 *   twice, in two languages, with nothing recording what was applied — and one of those
 *   gates blocked a deploy today because its own path had rotted.
 *
 * ⛔ THERE IS NO `Bao.Secret`, AND THERE MUST NEVER BE ONE. Alchemy persists attributes to
 *   its state store and does NOT encrypt them: StateEncoding.ts unwraps `Redacted` to
 *   plaintext under a marker key, and nothing under alchemy/src/State encrypts. This
 *   estate's state store is the `alchemy` Postgres database, which pg-backup.sh dumps
 *   nightly (it enumerates EVERY non-template database), copies to CT100, and PBS backs up
 *   from there. A KV value here would exist in four places, none of them OpenBao.
 *
 *   So this declares the SHAPE AROUND secrets. Every attribute it stores is a name, a
 *   count, or a hash.
 *
 * ⛔ EVERY PRIMITIVE IS ALCHEMY'S OR EFFECT'S, NOT NODE'S. An earlier cut of this file used
 *   `node:child_process` + `promisify(execFile)` and `node:fs/promises`, which is
 *   hand-rolling inside a bun + Effect codebase: it loses the Scope, the typed
 *   PlatformError, and the Layer that makes the provider testable without a real vault.
 *   ★ `CommandExecutor.run` was tried first and blocked read/diff: Alchemy passes a session
 *   to reconcile/delete but NOT to read/diff (Provider.ts:258-289), so the fix was Alchemy's
 *   OWN Docker pattern — `ChildProcessSpawner` + `ChildProcess.make`, which needs only a
 *   Scope (Docker.ts:476-553). ★ SINCE 2026-09-14 THE CALLS ARE OpenBao's HTTP API through
 *   Effect's `HttpClient` (bao-http.ts), which needs no session either, so read/diff still work.
 *   FileSystem and Path come from `effect/*` directly — in Effect 4 they moved into core.
 */
export interface BaoPolicyProps {
  /** Policy name, as `sys/policies/acl/<name>` takes it. */
  name: string;
  /**
   * Directory of `*.hcl` fragments.
   *
   * ⚠️ CONCATENATED IN SORTED ORDER, EACH FOLLOWED BY A NEWLINE — byte-identical to
   *   apply-agent-policy.sh, which is what wrote the live policy. Any other joining makes
   *   the first plan report an update on a policy nobody changed.
   */
  fragments: string;
}

export interface BaoPolicyAttributes {
  /** Policy name. */
  name: string;
  /** SHA-256 of the assembled HCL. The whole diff, and safe to persist. */
  digest: string;
  /** `path "..."` grants — the number apply-agent-policy.sh prints. */
  grants: number;
  /** Fragment files that produced it, so a plan reads like the directory. */
  parts: number;
}

export interface BaoPolicy extends Resource<
  'Bao.Policy',
  BaoPolicyProps,
  BaoPolicyAttributes,
  never,
  HttpClient.HttpClient | FileSystem.FileSystem | Path.Path
> {}

/**
 * ⛔ `retain` — DELETING A POLICY REVOKES EVERY GRANT IT CARRIES, and this is the ONLY family in
 *   this package with live instances, so it is the only one where the default could ever fire.
 *
 * 🔴 IT WAS THE ONLY FAMILY WITHOUT IT. Every sibling passes `{ defaultRemovalPolicy: 'retain' }`
 *   — auth-role.ts:37, mount.ts:40, pki-role.ts, proxmox-role.ts, ssh-role.ts — each with a ★
 *   explaining what deletion destroys. This file has the same warning on its own `delete` handler
 *   and did not carry the option, which is the worst possible combination: the danger is
 *   documented and the guard is missing.
 *   ⛔ WHAT THAT MEANT IN PRACTICE, on 2026-09-13: ten live policies are named in a `const` array
 *     in alchemy.run.ts. Removing a name from that array orphans the resource, and without
 *     `retain` the next deploy calls `bao policy delete` on it — including the 86-line policy that
 *     decides what the agent working in this repo can reach. A one-word edit, no plan line saying
 *     "revoke", and the grants are gone. The array grew from four names to ten that same day,
 *     which multiplied the blast radius of a mistake nobody had guarded against.
 *
 * ⚠️ `retain` DOES NOT WEAKEN `delete`, WHICH STAYS FULLY IMPLEMENTED. The engine skips it for an
 *   orphaned resource; a caller that means it opts in with `.pipe(RemovalPolicy.destroy())`. This
 *   is Terraform's `prevent_destroy`, not a stubbed operation — a delete that silently did nothing
 *   would lie to whoever read the plan.
 * ⚠️ `retain` ALSO KEEPS THE OLD GENERATION OF A RENAME. A new `name` plans `replace`, and under
 *   `retain` the old policy is left live and unmanaged (rename.ts, REPLACE.md).
 */
export const BaoPolicy = Resource<BaoPolicy>('Bao.Policy', {
  defaultRemovalPolicy: 'retain',
});

/** A policy is its name, keyed as OpenBao keys it (`policyKey`). */
const IDENTITY = nameIdentity<BaoPolicyAttributes>('Bao.Policy', policyPath, policyKey);

/** `path "..."` grant count — the same number the apply script prints. */
const grantsOf = (hcl: string) => (hcl.match(/^path /gm) ?? []).length;

const attributesOf = (name: string, hcl: string, parts: number): BaoPolicyAttributes => ({
  name,
  digest: sha256(hcl),
  grants: grantsOf(hcl),
  parts,
});

export const BaoPolicyProvider = () =>
  Provider.effect(
    BaoPolicy,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      /** Assemble fragments exactly as apply-agent-policy.sh does. */
      const assemble = (dir: string) =>
        Effect.gen(function* () {
          const entries = (yield* fs.readDirectory(dir)).filter((f) => f.endsWith('.hcl')).sort();
          let joined = '';
          for (const f of entries) joined += `${yield* fs.readFileString(path.join(dir, f))}\n`;
          return { joined, parts: entries.length };
        });

      return BaoPolicy.Provider.of({
        /**
         * ⛔ `bao policy list` IS NOT A LIST OF THINGS THIS OWNS. Every policy in the
         *   namespace answers, including ones written by hand years ago. Returning them
         *   would invite Alchemy to adopt — and then delete — policies it never created.
         */
        list: () => Effect.succeed([]),

        // ★ '' means genuinely absent (a 404); a refusal fails. policy-wire.ts has the history.
        // ⛔ With no attributes in state, a live policy is `Unowned` unless it is the one our own
        //   interrupted create wrote: these fragments, byte for byte (ownership/probe.ts).
        read: Effect.fn(function* ({ fqn, instanceId, olds, output }) {
          const live = yield* readPolicy(olds.name);
          const found = live.length === 0 ? undefined : attributesOf(olds.name, live, 0);
          const ours = Effect.map(
            assemble(olds.fragments),
            (a) => sha256(a.joined) === found?.digest,
          );
          return yield* ownedRead({ fqn, instanceId, output }, found, ours);
        }),

        /**
         * ⛔ IT COMPARES THE LIVE POLICY, NOT THE STORED DIGEST. A policy edited in the
         *   OpenBao UI is exactly the drift the check-* gates exist to catch, and a
         *   provider that trusted its own state would report `noop` straight through it.
         */
        diff: Effect.fn(function* ({ instanceId, news, olds, output }) {
          /**
           * ⛔ A RENAMED POLICY IS A `replace`, DECIDED BEFORE ANY OTHER READ (rename.ts). Until
           *   2026-09-21 this read the new name, found nothing and planned `update`: the new policy
           *   was written and the old one kept every grant under no state record. Names compare as
           *   OpenBao keys them (`policyKey`), so a change of case is the same policy, never a
           *   replace. ⛔ A rename onto a policy that already exists fails the plan (`judgeMove`).
           * ⚠️ UNDER THE DEFAULT `retain` THE OLD POLICY STAYS LIVE, GRANTS AND ALL, for every token,
           *   role and group that still names it. Under `destroy` they lose those grants at the
           *   delete, so a role outside this graph that names the old policy must move in the same
           *   PR (REPLACE.md).
           */
          const move = yield* judgeRename(IDENTITY, olds, news, output);
          if (output === undefined) return yield* noteResume(instanceId);
          if (move !== undefined) return { action: 'replace' } as const;
          // ⚠️ A prop can still be an unresolved Output or Config at plan time. Docker's
          //   own providers guard with isResolved and skip rather than guess; a diff that
          //   read a Config as a string would compare a placeholder to real HCL.
          if (!isResolved(news)) return undefined;
          const { joined } = yield* assemble(news.fragments);
          const live = yield* readPolicy(news.name);
          return live.length > 0 && sha256(live) === sha256(joined)
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),

        reconcile: Effect.fn(function* ({ fqn, instanceId, news, output }) {
          const name = news.name;
          // ⛔ An `update` across a rename the diff could not see — refused before any write.
          yield* guardRename(IDENTITY, news, output);
          const { joined, parts } = yield* assemble(news.fragments);
          /**
           * ⛔ AN EMPTY ASSEMBLY IS A REFUSAL, NOT AN EMPTY POLICY. `bao policy write` with
           *   no paths SILENTLY REVOKES every grant the policy carries, for every token
           *   bound to it — and a mistyped or moved fragments directory reads exactly like
           *   a policy with nothing in it. This estate lost a deploy today to a directory
           *   that moved; it must not lose a vault to one.
           */
          // ⛔ No FILES was the first guard; no GRANT is the real one — see policy-assembly.ts.
          if (isEmptyAssembly(parts, joined))
            return yield* Effect.die(
              new Error(
                `Bao.Policy ${name}: the fragments under ${news.fragments} carry no path grant ` +
                  `(${String(parts)} file(s)). Writing it would revoke every grant the policy carries.`,
              ),
            );
          /**
           * ⛔ ADOPTING A POLICY THAT ALREADY MATCHES MUST NOT REWRITE IT. Alchemy's `adopted`
           *   action is NOT a read — Apply.ts routes it down the same branch as `update` and calls
           *   reconcile — so the first deploy after declaring the four policies this estate
           *   already has would have run `bao policy write` over all four. Byte-identical in the
           *   happy case, and a SILENT REWRITE OF LIVE GRANTS the moment the repo fragments have
           *   drifted from what is deployed.
           *
           * ★ THE GUARD IS THE SAME EXPRESSION `diff` USES, deliberately: one definition of
           *   "settled" for this resource, so the plan and the write can never disagree. The
           *   sibling PVE provider does exactly this in pveOperations.reconcile.
           */
          const current = yield* readPolicy(name);
          if (current.length > 0)
            yield* refuseTakeover({ fqn, instanceId, output }, `Bao.Policy ${name}`);
          if (current.length > 0 && sha256(current) === sha256(joined)) {
            return attributesOf(name, joined, parts);
          }
          // ⚠️ In the request body, never on argv — see `writePolicy` for why the temp file went.
          yield* writePolicy(name, joined);
          return attributesOf(name, joined, parts);
        }),

        /**
         * ⛔ DELETING A POLICY REVOKES EVERY GRANT IT CARRIES. Idempotent as Alchemy
         *   requires — already gone is success — but this is the one operation with teeth.
         */
        delete: Effect.fn(function* ({ output }) {
          /**
           * ⛔ A REFUSED DELETE FAILS. This is "the one operation with teeth" the note above
           *   names, and it used to run through the read helper, which discarded the exit code —
           *   so a REFUSED policy delete reported success and the row left Alchemy's state while
           *   every grant it carried stayed live. Idempotence is preserved: a 404 is still
           *   success, and a 403 is not (bao-status.ts).
           */
          yield* deletePolicy(output.name);
          return undefined;
        }),
      });
    }),
  );
