/**
 * `hf-adopt-verify`'s flags — the ones `alchemy plan` takes, so a stack script can swap one
 * command for the other.
 *
 * ★ `node:util` parseArgs, NOT effect's CLI module. Alchemy builds its CLI on
 *   `effect/unstable/cli`, but that needs a CliConfig and a Terminal layer to parse six flags; the
 *   standard library parses them with no service at all, which keeps this pure and testable.
 * ⛔ `--stage` HAS NO GUESSED DEFAULT. Alchemy falls back to `live_$USER`; a gate that silently
 *   verified the wrong stage would pass for the wrong reason. It comes from the flag or from
 *   `$ALCHEMY_STAGE`, or the run stops.
 */
import { parseArgs } from 'node:util';
import type { VerifyOptions, VerifyTarget } from './verify.ts';

export const USAGE = `Usage: hf-adopt-verify --stage <stage> [--config alchemy.run.ts] [options]

Plans the stack with Alchemy's own planner, never writes, and reports each row
without a state row: what the engine planned, the provider's read and its own
diff (before Alchemy forces adopted rows to update), and the declared fields
that differ from the live object. Exits 0 when every row is a no-op, 1 when
any is not, 2 when it could not tell.

  -c, --config <file>   stack entrypoint (default alchemy.run.ts)
      --stage <stage>   stage to verify (default $ALCHEMY_STAGE; required)
      --profile <name>  Alchemy auth profile
      --env-file <file> .env file layered under the environment
      --all             report every declared row and pending deletion
      --json            print the report as JSON
  -h, --help            this text
`;

export type Parsed =
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'run';
      readonly target: VerifyTarget;
      readonly options: VerifyOptions;
      readonly json: boolean;
    };

const parse = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    allowPositionals: false,
    options: {
      all: { type: 'boolean', default: false },
      config: { type: 'string', short: 'c', default: 'alchemy.run.ts' },
      'env-file': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      json: { type: 'boolean', default: false },
      profile: { type: 'string' },
      stage: { type: 'string' },
    },
    strict: true,
  });

/** Parse argv (without the runtime and script) against the environment. Never throws. */
export const parseVerifyArgs = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Parsed => {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  const { values } = parsed;
  if (values.help) return { kind: 'help' };
  const stage = values.stage ?? env['ALCHEMY_STAGE'];
  if (stage === undefined || stage === '') {
    return { kind: 'error', message: 'pass --stage (or set ALCHEMY_STAGE): no stage is guessed' };
  }
  const target: VerifyTarget = {
    entrypoint: values.config,
    stage,
    ...(values.profile === undefined ? {} : { profile: values.profile }),
    ...(values['env-file'] === undefined ? {} : { envFile: values['env-file'] }),
  };
  return { json: values.json, kind: 'run', options: { all: values.all }, target };
};
