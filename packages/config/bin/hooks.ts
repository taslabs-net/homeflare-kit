#!/usr/bin/env bun
/**
 * The entry a repo's `.husky/` wrapper calls, and its `prepare` script.
 *
 * ⚠️ IT IMPORTS `../src`, NOT `../dist`. `src` is published, Bun runs TypeScript
 *   directly, and a hook that depended on a build step would be dead in a fresh clone
 *   of the repo that HOSTS this package — the one place `dist/` does not exist yet.
 * ⚠️ STDIN IS READ FOR `pre-push` ONLY, AND NEVER FROM A TERMINAL. git pipes the pushed refs
 *   to that hook; a person running it by hand has a TTY there, and reading it would hang.
 */
import { isCommand, runCommand } from '../src/hooks.ts';

const [command = '', ...args] = process.argv.slice(2);

if (!isCommand(command)) {
  process.stderr.write(`homeflare hooks: unknown command ${JSON.stringify(command)}\n`);
  process.stderr.write('  expected one of: pre-commit, pre-push, install, activate\n');
  process.exit(2);
}

const stdin = command === 'pre-push' && !process.stdin.isTTY ? await Bun.stdin.text() : '';

await runCommand(command, process.cwd(), args, stdin);
