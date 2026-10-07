/**
 * `parseYaml` — a syntax error is "not a document"; nothing else is swallowed. And the adapter's
 * kubeconfig reader no longer reports a parser/runtime fault as an unreadable kubeconfig.
 */
import { expect, spyOn, test } from 'bun:test';
import { kubeconfigTransport } from './kubeconfig-doc.ts';
import { parseYaml } from './yaml-parse.ts';

test('valid YAML parses and a syntax error is undefined', () => {
  expect(parseYaml('a: 1\nb: [x, y]\n')).toEqual({ a: 1, b: ['x', 'y'] });
  expect(parseYaml('a: [unclosed\n')).toBeUndefined();
});

test('an unresolved tag beside key material emits no warning carrying the source', () => {
  // ⛔ yaml's default logLevel is 'warn': process.emitWarning with the SOURCE TEXT. Reproduced in
  //   hunt round 5: the whole client-key-data landed on stderr while parsing still succeeded.
  // A fresh random needle per run: a fixed high-entropy literal here is exactly what the secret scan refuses.
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const text = `users:\n  - user:\n      client-key-data: ${secret}\n      other: !nosuchtag value\n`;
  const emitted: string[] = [];
  const warn = spyOn(process, 'emitWarning').mockImplementation(((w: unknown) => {
    emitted.push(String(w instanceof Error ? w.message : w));
  }) as never);
  const err = spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => {
    emitted.push(String(c));
    return true;
  }) as never);
  try {
    expect(parseYaml(text)).toBeDefined();
  } finally {
    warn.mockRestore();
    err.mockRestore();
  }
  expect(emitted.join('\n')).not.toContain(secret);
  expect(emitted).toEqual([]);
});

test('kubeconfigTransport returns undefined for a non-document, not for a fault', () => {
  expect(kubeconfigTransport('a: [unclosed\n', 'admin@c1')).toBeUndefined();
  expect(kubeconfigTransport('- just\n- a list\n', 'admin@c1')).toBeUndefined();
});
