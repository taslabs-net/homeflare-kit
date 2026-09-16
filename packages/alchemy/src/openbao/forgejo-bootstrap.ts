/**
 * The forgejo-provision service account: created once, by a person, with its password handed
 * straight to the Forgejo engine's role and nowhere else.
 *
 * ★ TIM'S CALL, 2026-09-14: "Random password, piped", and membership of the HomeFlare Owners team
 *   (house/forgejo, Forgejo.TeamMember). Forgejo has no service-account type and no app.ini setting
 *   that creates users — the bot type is database-only (codeberg issue 8136) — so this is an
 *   ordinary user made by `forgejo admin user create`.
 *
 * ⛔ AN AGENT DOES NOT RUN THIS. Creating an account is a human step (32-forgejo-provision.hcl).
 *   Everything around it is not: the engine, its config, the team membership and the mint proof.
 *
 * ⛔ THE PASSWORD EXISTS IN THIS PROCESS AND IN ONE OPENBAO WRITE, AND NOWHERE ELSE.
 *   - Forgejo generates it (`--random-password`), so it is never in argv, where `ps` shows it.
 *   - Its stdout line is parsed and never echoed (forgejo-bootstrap-parse.ts).
 *   - It lands in `forgejo/roles/provision` as `mint_password`, which the engine never returns on a
 *     read (plugin-forgejo path_roles.go:63-71, :219-227).
 *   - It is never a file, an environment variable, a log line or an Alchemy prop.
 *
 * ★ EVERYTHING THAT CAN FAIL IS CHECKED BEFORE THE ACCOUNT EXISTS. An account whose password was
 *   lost between the CLI and OpenBao is the one failure a rerun cannot fix. So the preflight runs
 *   first, and if the write still fails after that, the account is deleted again so a rerun starts
 *   clean.
 */
import * as Effect from 'effect/Effect';
import { baoCall, baoRead, baoWrite } from './bao-http.ts';
import {
  FORGEJO_CONFIG,
  FORGEJO_WORK_PATH,
  readCreateOutput,
  runningForgejoBinary,
  tailOf,
  usernamesFrom,
} from './forgejo-bootstrap-parse.ts';

export const PROVISION_USER = 'forgejo-provision';
/** `NO_REPLY_ADDRESS` in hosts/macmini/forgejo/app.ini:117 — a service account's mail goes nowhere. */
const PROVISION_EMAIL = `${PROVISION_USER}@noreply.lab.example.com`;
export const ROLE_PATH = 'forgejo/roles/provision';

/**
 * ★ THE SCOPES ARE WHAT house/forgejo WRITES TODAY. Org labels, teams and org secrets need
 *   `write:organization`; repositories, webhooks and branch protection need `write:repository`.
 *   Membership decides what the tokens can reach, and the scopes cap it.
 * ⚠️ FORGEJO TOKENS NEVER EXPIRE ON THE SERVER. The TTL is OpenBao's lease, and revoking the lease is
 *   the only kill switch (path_roles.go:206-207).
 */
const ROLE = { max_ttl: '1h', scopes: 'write:organization,write:repository', ttl: '15m' } as const;

const refuse = (message: string) => Effect.fail(new Error(message));
const say = (line: string) => Effect.sync(() => process.stdout.write(`${line}\n`));

/** Run a command and collect everything it printed. ⛔ argv must never carry a secret. */
const run = (argv: readonly string[]) =>
  Effect.tryPromise({
    catch: (cause) => new Error(`${argv.slice(0, 4).join(' ')} could not run: ${String(cause)}`),
    try: async () => {
      const child = Bun.spawn([...argv], { stderr: 'pipe', stdin: 'ignore', stdout: 'pipe' });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { code, stderr, stdout };
    },
  });

export const bootstrapProvisionAccount = Effect.gen(function* () {
  // ── 1. OpenBao: the engine is configured, the role is absent, and this token may create it.
  const config = yield* baoRead('forgejo/config');
  if (typeof config?.['api_base_url'] !== 'string') {
    return yield* refuse('forgejo/config has no api_base_url. Configure the engine first.');
  }
  const existing = yield* baoRead(ROLE_PATH);
  if (existing !== undefined) {
    return yield* refuse(
      `${ROLE_PATH} already exists (mint_user ${String(existing['mint_user'])}). Nothing to do.`,
    );
  }
  const capabilities = yield* baoCall('write', 'POST', 'sys/capabilities-self', {
    paths: [ROLE_PATH],
  });
  const granted = capabilities?.[ROLE_PATH];
  if (!Array.isArray(granted) || !granted.some((c) => c === 'create' || c === 'root')) {
    return yield* refuse(
      `this BAO_TOKEN cannot create ${ROLE_PATH} (capabilities: ${JSON.stringify(granted)}).`,
    );
  }

  // ── 2. Forgejo: the running binary, and no account by that name yet.
  const ps = yield* run(['ps', '-axo', 'command']);
  const binary = runningForgejoBinary(ps.stdout);
  if (binary === undefined) {
    return yield* refuse(
      'no running `forgejo web` found. Run this on the mini, where Forgejo runs.',
    );
  }
  const cli = (subcommand: string, ...args: string[]) =>
    run([
      binary,
      'admin',
      'user',
      subcommand,
      '--work-path',
      FORGEJO_WORK_PATH,
      '--config',
      FORGEJO_CONFIG,
      ...args,
    ]);
  const listUsers = Effect.gen(function* () {
    const listed = yield* cli('list');
    if (listed.code !== 0) {
      return yield* refuse(
        `forgejo admin user list exited ${listed.code}: ${tailOf(listed.stderr)}`,
      );
    }
    return yield* Effect.try({
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      try: () => usernamesFrom(listed.stdout),
    });
  });
  if ((yield* listUsers).includes(PROVISION_USER)) {
    return yield* refuse(
      `Forgejo already has ${PROVISION_USER} but OpenBao has no role for it, so its password is ` +
        'unknown. Delete that account deliberately, then rerun.',
    );
  }

  /** ⛔ Only an account THIS run just created is ever removed, and only when its password is lost. */
  const rollback = (reason: string) =>
    Effect.gen(function* () {
      if (!(yield* listUsers).includes(PROVISION_USER)) return;
      const removed = yield* cli('delete', '--username', PROVISION_USER);
      yield* say(
        removed.code === 0
          ? `  rolled back: deleted ${PROVISION_USER}, because ${reason}`
          : `  ⛔ ROLLBACK FAILED (${tailOf(removed.stderr)}). ${PROVISION_USER} exists with a ` +
              'password nobody holds. Delete it by hand before rerunning.',
      );
    });

  // ── 3. The one step that makes a secret.
  const created = yield* cli(
    'create',
    '--username',
    PROVISION_USER,
    '--email',
    PROVISION_EMAIL,
    '--fullname',
    'Forgejo provision (OpenBao engine)',
    '--random-password',
    '--random-password-length',
    '40',
    '--must-change-password=false',
  );
  const output = readCreateOutput(created.stdout, PROVISION_USER);
  for (const line of output.rest) yield* say(`  forgejo: ${line}`);
  const password = output.password;
  if (created.code !== 0 || !output.created || password === undefined) {
    const reason = `create exited ${created.code} (${tailOf(created.stderr)})`;
    yield* rollback(reason);
    return yield* refuse(`${PROVISION_USER} was not created cleanly: ${reason}`);
  }

  // ── 4. Straight into the engine, then read back rather than trusting the write.
  yield* baoWrite('PUT', ROLE_PATH, {
    ...ROLE,
    mint_password: password,
    mint_user: PROVISION_USER,
  }).pipe(Effect.tapError((error) => rollback(`the OpenBao write failed: ${error.message}`)));
  const role = yield* baoRead(ROLE_PATH);
  if (role?.['mint_user'] !== PROVISION_USER || role['mint_password_set'] !== true) {
    return yield* refuse(
      `${ROLE_PATH} wrote cleanly but reads back ${JSON.stringify(role)}. Inspect it before retrying.`,
    );
  }
  yield* say(
    `ok: ${PROVISION_USER} created, and ${ROLE_PATH} holds its password (write-only). ` +
      `Scopes ${ROLE.scopes}, lease ${ROLE.ttl}, max ${ROLE.max_ttl}.`,
  );
});
