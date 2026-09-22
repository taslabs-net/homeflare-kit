/**
 * A fake `pvesh` / `pveum` / `id` for the bootstrap tests: the generated script runs for real, under
 * `sh`, with real Perl parsing the JSON, against an access config held in one JSON file — so what is
 * tested is the script a person pipes to a node, not a model of it.
 *
 * ⛔ TEST-ONLY. No provider imports this file. Run as a program (`import.meta.main`), it IS the fake
 *   CLI; imported, it is the harness that writes the wrappers and runs a script against them.
 * ★ IT REFUSES WHAT PVE REFUSES WHERE ORDER MATTERS: adding an object that exists, modifying one
 *   that does not, a user in a group that does not exist, a grant of a role that does not exist.
 *   A script that runs its steps in the wrong order fails here as it would on a node.
 * ★ READS ANSWER IN THE ITEM SHAPES access/*.ts DOCUMENT: a role is a privilege map, a user's
 *   groups an array, empty strings omitted. `apiView` is also what the engine test's fake PVE
 *   serves, so the bootstrap's result and the declaration are compared on one picture.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type CliUser = {
  comment: string;
  email: string;
  enable: number;
  expire: number;
  firstname: string;
  lastname: string;
  groups: string[];
};
export type CliGrant = {
  path: string;
  type: string;
  ugid: string;
  roleid: string;
  propagate: number;
};
export type CliState = {
  roles: Record<string, string[]>;
  groups: Record<string, { comment: string }>;
  users: Record<string, CliUser>;
  acl: CliGrant[];
};

/** A cluster as PVE installs it: the built-in auditor role, and nothing of the baseline. */
export const freshCluster = (): CliState => ({
  acl: [],
  groups: {},
  roles: {
    PVEAuditor: [
      'Datastore.Audit',
      'Mapping.Audit',
      'Pool.Audit',
      'SDN.Audit',
      'Sys.Audit',
      'VM.Audit',
    ],
  },
  users: {},
});

const text = (key: string, value: string) => (value === '' ? {} : { [key]: value });

/** Every item GET the scripts and the providers make, keyed `access/…` without a leading slash. */
export const apiView = (state: CliState): Record<string, unknown> => {
  const view: Record<string, unknown> = { 'access/acl': state.acl };
  for (const [id, privs] of Object.entries(state.roles)) {
    view[`access/roles/${id}`] = Object.fromEntries(privs.map((priv) => [priv, 1]));
  }
  for (const [id, group] of Object.entries(state.groups)) {
    const members = Object.keys(state.users).filter((u) => state.users[u]?.groups.includes(id));
    view[`access/groups/${id}`] = { ...text('comment', group.comment), members };
  }
  for (const [id, user] of Object.entries(state.users)) {
    view[`access/users/${id}`] = {
      ...text('comment', user.comment),
      ...text('email', user.email),
      ...text('firstname', user.firstname),
      ...text('lastname', user.lastname),
      enable: user.enable,
      expire: user.expire,
      groups: user.groups,
      tokens: {},
    };
  }
  return view;
};

const flags = (args: string[]) => {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2)
    out[(args[i] ?? '').replace(/^--/, '')] = args[i + 1] ?? '';
  return out;
};

/** One pveum call against `state`; returns the refusal PVE would print, or undefined. */
const pveum = (state: CliState, [kind, verb, id = '', ...rest]: string[]): string | undefined => {
  const f = flags(rest);
  const list = (csv: string | undefined) => (csv ?? '').split(',').filter((s) => s !== '');
  if (kind === 'role') {
    if ((verb === 'add') === id in state.roles) return `role '${id}': wrong state for ${verb}`;
    state.roles[id] = list(f['privs']);
  } else if (kind === 'group') {
    if ((verb === 'add') === id in state.groups) return `group '${id}': wrong state for ${verb}`;
    state.groups[id] = { comment: f['comment'] ?? '' };
  } else if (kind === 'user') {
    const had = state.users[id];
    if ((verb === 'add') === (had !== undefined)) return `user '${id}': wrong state for ${verb}`;
    const groups = f['groups'] === undefined ? (had?.groups ?? []) : list(f['groups']);
    const missing = groups.find((g) => !(g in state.groups));
    if (missing !== undefined) return `no such group '${missing}'`;
    const base: CliUser = had ?? {
      comment: '',
      email: '',
      enable: 1,
      expire: 0,
      firstname: '',
      lastname: '',
      groups: [],
    };
    state.users[id] = {
      comment: f['comment'] ?? base.comment,
      email: f['email'] ?? base.email,
      enable: f['enable'] === undefined ? base.enable : Number(f['enable']),
      expire: f['expire'] === undefined ? base.expire : Number(f['expire']),
      firstname: f['firstname'] ?? base.firstname,
      groups,
      lastname: f['lastname'] ?? base.lastname,
    };
  } else if (kind === 'acl' && verb === 'modify') {
    const roleid = f['roles'] ?? '';
    if (!(roleid in state.roles)) return `role '${roleid}' does not exist`;
    const grant = {
      path: id,
      propagate: Number(f['propagate'] ?? 1),
      roleid,
      type: 'user',
      ugid: f['users'] ?? '',
    };
    state.acl = state.acl.filter(
      (g) => !(g.path === id && g.ugid === grant.ugid && g.roleid === roleid),
    );
    state.acl.push(grant);
  } else return `unknown pveum call: ${kind} ${verb}`;
  return undefined;
};

/** The fake CLI's entry point: `<tool> <args…>`, with FAKE_PVE_STATE and FAKE_PVE_LOG set. */
const runCli = ([tool, ...args]: string[]): number => {
  if (tool === 'id') {
    process.stdout.write('0\n');
    return 0;
  }
  const file = process.env['FAKE_PVE_STATE'] ?? '';
  const state = JSON.parse(readFileSync(file, 'utf8')) as CliState;
  if (tool === 'pvesh') {
    const found = apiView(state)[(args[1] ?? '').replace(/^\//, '')];
    if (found === undefined) {
      process.stderr.write(`no such object ${args[1] ?? ''}\n`);
      return 2;
    }
    process.stdout.write(JSON.stringify(found));
    return 0;
  }
  appendFileSync(process.env['FAKE_PVE_LOG'] ?? '', `pveum ${args.join(' ')}\n`);
  const refused = pveum(state, args);
  if (refused !== undefined) {
    process.stderr.write(`${refused}\n`);
    return 255;
  }
  writeFileSync(file, JSON.stringify(state));
  return 0;
};

if (import.meta.main) process.exit(runCli(process.argv.slice(2)));

export type ScriptRun = {
  code: number;
  stdout: string;
  stderr: string;
  writes: string[];
  state: CliState;
};

/** Run `script` under `sh` against `state`, with the fakes first on PATH. */
export const runScript = async (script: string, state: CliState): Promise<ScriptRun> => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-bootstrap-'));
  for (const tool of ['id', 'pvesh', 'pveum']) {
    const wrapper = `#!/bin/sh\nexec '${process.execPath}' '${import.meta.path}' ${tool} "$@"\n`;
    writeFileSync(join(dir, tool), wrapper, { mode: 0o755 });
  }
  const stateFile = join(dir, 'state.json');
  const log = join(dir, 'pveum.log');
  writeFileSync(stateFile, JSON.stringify(state));
  writeFileSync(log, '');
  try {
    const child = Bun.spawn(['sh', '-s'], {
      env: {
        FAKE_PVE_LOG: log,
        FAKE_PVE_STATE: stateFile,
        PATH: `${dir}:${process.env['PATH'] ?? ''}`,
      },
      stderr: 'pipe',
      stdin: new TextEncoder().encode(script),
      stdout: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const writes = readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    const after = JSON.parse(readFileSync(stateFile, 'utf8')) as CliState;
    return { code, state: after, stderr, stdout, writes };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};
