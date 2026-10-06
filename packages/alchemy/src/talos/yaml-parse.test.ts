/**
 * `parseYaml` — a syntax error is "not a document"; nothing else is swallowed. And the adapter's
 * kubeconfig reader no longer reports a parser/runtime fault as an unreadable kubeconfig.
 */
import { expect, test } from 'bun:test';
import { kubeconfigTransport } from './kubeconfig-doc.ts';
import { parseYaml } from './yaml-parse.ts';

test('valid YAML parses and a syntax error is undefined', () => {
  expect(parseYaml('a: 1\nb: [x, y]\n')).toEqual({ a: 1, b: ['x', 'y'] });
  expect(parseYaml('a: [unclosed\n')).toBeUndefined();
});

test('kubeconfigTransport returns undefined for a non-document, not for a fault', () => {
  expect(kubeconfigTransport('a: [unclosed\n', 'admin@c1')).toBeUndefined();
  expect(kubeconfigTransport('- just\n- a list\n', 'admin@c1')).toBeUndefined();
});
