#!/usr/bin/env bun
/**
 * The entry a repo's `.husky/` wrapper calls.
 *
 * ⚠️ IT IMPORTS `../src`, NOT `../dist`. `src` is published, Bun runs TypeScript
 *   directly, and a hook that depended on a build step would be dead in a fresh clone
 *   of the repo that HOSTS this package — the one place `dist/` does not exist yet.
 */
import { isCommand, runCommand } from '../src/hooks.ts';

const command = process.argv[2] ?? '';

if (!isCommand(command)) {
  process.stderr.write(`homeflare hooks: unknown command ${JSON.stringify(command)}\n`);
  process.stderr.write('  expected one of: pre-commit, pre-push, install\n');
  process.exit(2);
}

await runCommand(command, process.cwd());
