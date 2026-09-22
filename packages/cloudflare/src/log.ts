/**
 * Structured logging for Workers.
 *
 * ★ WHY NO LOGGING LIBRARY. Cloudflare Workers Logs parses `console.log` output as JSON
 *   natively and indexes every field, with unlimited cardinality — so a JSON object on
 *   console IS the structured logging integration. pino is Node-shaped (streams, worker
 *   threads) and needs a wrapper on workerd; `pino-pretty` does not work with wrangler
 *   at all (workers-sdk#6841). Adding a dependency here would buy formatting we do not
 *   want and cost bundle size on a hot path.
 *   Docs: developers.cloudflare.com/workers/observability/logs/workers-logs/
 *
 * ⛔ NEVER LOG A CREDENTIAL. There is no redaction layer here and deliberately so — a
 *   redactor implies it is safe to pass secrets in, and then quietly misses one.
 */

/** Anything JSON-serialisable. Workers Logs indexes each key as its own field. */
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  readonly debug: (message: string, fields?: LogFields) => void;
  readonly info: (message: string, fields?: LogFields) => void;
  readonly warn: (message: string, fields?: LogFields) => void;
  readonly error: (message: string, fields?: LogFields) => void;
  /** Returns a logger that merges `bound` into every subsequent line. */
  readonly with: (bound: LogFields) => Logger;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, message: string, fields: LogFields): void {
  // ⚠️ ONE OBJECT, NOT (message, fields). console.log with several arguments is
  //   stringified and concatenated by the runtime, which destroys the structure Workers
  //   Logs would otherwise index — the symptom is a `message` field containing your
  //   whole payload as text, unqueryable.
  const line = { level, message, ...fields };

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function make(bound: LogFields): Logger {
  return {
    debug: (message, fields) => emit('debug', message, { ...bound, ...fields }),
    info: (message, fields) => emit('info', message, { ...bound, ...fields }),
    warn: (message, fields) => emit('warn', message, { ...bound, ...fields }),
    error: (message, fields) => emit('error', message, { ...bound, ...fields }),
    with: (extra) => make({ ...bound, ...extra }),
  };
}

/**
 * The root logger. Bind request-scoped context rather than passing it every call:
 *
 *     const requestLog = log.with({ requestId, path: url.pathname });
 *     requestLog.info('handled', { status, ms });
 */
export const log: Logger = make({});
