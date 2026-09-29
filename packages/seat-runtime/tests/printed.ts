/**
 * Everything an error could put into a log line, for the assertion "no secret in it".
 *
 * ⚠️ `error.message` IS NOT ENOUGH. The first leak tests read only `message` and `server`, and
 *   a fetch failure's own `path` field (the full URL, query string included) went out through
 *   `Bun.inspect`, `console.error` and the default logger anyway (review of PR 328). So this is
 *   how Bun prints the error, plus every own field of it and of its `cause` chain, the
 *   non-enumerable `message` and `stack` included.
 */
export function printed(error: unknown): string {
  const fields = JSON.stringify(error, (_key, value: unknown) =>
    value instanceof Error
      ? Object.fromEntries(
          Object.getOwnPropertyNames(value).map((name) => [
            name,
            (value as unknown as Record<string, unknown>)[name],
          ]),
        )
      : value,
  );
  return `${Bun.inspect(error)}\n${fields}`;
}
