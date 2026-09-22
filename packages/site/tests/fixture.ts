/**
 * The example site, as raw JSON, plus a way to change one path without touching the rest.
 * ★ Every test starts from the shipped example, so the example is exercised by all of them
 *   and cannot rot into something that no longer decodes.
 */
export const EXAMPLE_PATH: string = new URL('../site.example.json', import.meta.url).pathname;

const raw = (await Bun.file(EXAMPLE_PATH).json()) as Record<string, unknown>;

/** A fresh deep copy of the example JSON. */
export function example(): Record<string, unknown> {
  return structuredClone(raw);
}

/** A copy of `input` with `path` set to `value` (`undefined` deletes the key). */
export function withPath(
  input: Record<string, unknown>,
  path: readonly (string | number)[],
  value: unknown,
): Record<string, unknown> {
  const out = structuredClone(input);
  let node: Record<string | number, unknown> = out;
  for (const segment of path.slice(0, -1)) {
    node = node[segment] as Record<string | number, unknown>;
  }
  const last = path.at(-1);
  if (last === undefined) throw new Error('empty path');
  if (value === undefined) delete node[last];
  else node[last] = value;
  return out;
}

/** Read `path` from a plain object. */
export function readPath(input: unknown, path: readonly (string | number)[]): unknown {
  let node = input;
  for (const segment of path) node = (node as Record<string | number, unknown>)[segment];
  return node;
}

/** `JSON.stringify` of a derive result: plain data only, methods dropped. */
export function render(value: unknown): string {
  return JSON.stringify(value);
}
