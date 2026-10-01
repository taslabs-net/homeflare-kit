/** Executable evidence for the documented beta.79 transport exception; no listener required. */
import { expect, test } from 'bun:test';
import { Parser } from 'alchemy/Redis';

test('upstream accepts replies beyond this provider’s byte and array caps', () => {
  const bytes = new TextEncoder();
  const bulk = new Parser();
  const length = 1024 * 1024 + 1;
  bulk.push(bytes.encode(`$${length}\r\n${'x'.repeat(length)}\r\n`));
  expect(bulk.next()._tag).toBe('Reply');
  const array = new Parser();
  array.push(bytes.encode(`*10001\r\n${'$-1\r\n'.repeat(10001)}`));
  expect(array.next()._tag).toBe('Reply');
});
