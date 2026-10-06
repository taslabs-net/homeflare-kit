/**
 * The one YAML parser of the Talos family — runtime-neutral, so it runs under Bun AND Node.
 *
 * ⛔ NOT `Bun.YAML`. The published `dist/` runs on Node for consumers (AGENTS.md: Bun is the
 *   toolchain, not the runtime). `Bun.YAML` is a missing global there: the old code swallowed that
 *   ReferenceError and reported every kubeconfig as unreadable (reproduced on Node 22: the adapter
 *   returned no transport). ★ `yaml` is the parser alchemy itself depends on (`yaml ^2.9.0`), so no
 *   new package enters a consumer's tree.
 * ⚠️ ONLY a YAML syntax error is `undefined` ("this is not a document"). Anything else — a broken
 *   import, a runtime fault — propagates, so a parser/runtime defect is never dressed up as bad
 *   vault content.
 */
import { YAMLParseError, parse } from 'yaml';

/** Parse one YAML document, or `undefined` when the text is not valid YAML. */
export const parseYaml = (text: string): unknown => {
  try {
    return parse(text);
  } catch (error) {
    if (error instanceof YAMLParseError) return undefined;
    throw error;
  }
};
