#!/usr/bin/env node
/**
 * `hf-adopt-verify` — the bin. Parse, verify, print, exit 0 / 1 / 2.
 *
 * ★ `runMain` IS ALCHEMY'S (alchemy/Util/PlatformServices), so this runs under bun or node the way
 *   `alchemy` itself does, and exits once the report is out rather than lingering on keep-alive
 *   sockets. Run it where the stack's `alchemy` runs: `bunx --bun hf-adopt-verify …` next to
 *   `bun ./node_modules/alchemy/bin/cli.js plan …`, because the entrypoint it imports is
 *   TypeScript.
 * ⛔ EXIT 2 IS "COULD NOT TELL", NEVER A PASS. A plan that fails — a provider that dies, an
 *   `adopt(false)` row that is not ours, a state store it cannot read — prints the cause and exits
 *   2, so a gate reading `!= 0` stops either way.
 */
import { runMain } from 'alchemy/Util/PlatformServices';
import * as Cause from 'effect/Cause';
import * as Console from 'effect/Console';
import * as Effect from 'effect/Effect';
import { USAGE, parseVerifyArgs } from './args.ts';
import { exitCodeOf, formatReport } from './report.ts';
import { verifyStack } from './verify.ts';

const setExit = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code;
  });

const program = Effect.gen(function* () {
  const parsed = parseVerifyArgs(process.argv.slice(2), process.env);
  if (parsed.kind === 'help') return yield* Console.log(USAGE);
  if (parsed.kind === 'error') {
    yield* Console.error(`hf-adopt-verify: ${parsed.message}\n\n${USAGE}`);
    return yield* setExit(2);
  }
  const report = yield* verifyStack(parsed.target, parsed.options);
  yield* Console.log(
    parsed.json
      ? JSON.stringify(report, null, 2)
      : formatReport(report, parsed.options.all === true),
  );
  yield* setExit(exitCodeOf(report));
}).pipe(
  Effect.catchCause((cause) =>
    Console.error(`hf-adopt-verify: the plan could not be verified\n${Cause.pretty(cause)}`).pipe(
      Effect.andThen(setExit(2)),
    ),
  ),
);

runMain(program);
