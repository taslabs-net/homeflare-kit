/**
 * The two small pure pieces under `mcpToolkit`: what a tool result reads like to a model, and
 * cursor pagination with its page cap.
 */
import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { McpToolkitError } from '../src/index.ts';
import { MAX_PAGES, collect } from '../src/mcp-pages.ts';
import { EMPTY_RESULT, renderContent, renderResult } from '../src/mcp-render.ts';

describe('renderContent', () => {
  test('text blocks are passed through and joined by newlines', () => {
    expect(
      renderContent([
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
      ]),
    ).toBe('one\ntwo');
  });

  test('an image or audio block becomes a marker, never its bytes', () => {
    const bytes = 'A'.repeat(4096);
    const out = renderContent([
      { type: 'image', data: bytes, mimeType: 'image/png' },
      { type: 'audio', data: bytes, mimeType: 'audio/wav' },
    ]);
    expect(out).toBe('[image: image/png, not shown]\n[audio: audio/wav, not shown]');
    expect(out).not.toContain(bytes);
  });

  test('a resource link and an embedded resource are named, text is shown, a blob is not', () => {
    expect(renderContent([{ type: 'resource_link', uri: 'estate://a', name: 'a' }])).toBe(
      '[resource link: estate://a]',
    );
    expect(
      renderContent([{ type: 'resource', resource: { uri: 'estate://b', text: 'inline text' } }]),
    ).toBe('inline text');
    expect(
      renderContent([{ type: 'resource', resource: { uri: 'estate://c', blob: 'AAAA' } }]),
    ).toBe('[resource: estate://c, not shown]');
  });

  test('an unknown block type is named, not dropped', () => {
    expect(renderContent([{ type: 'hologram' }])).toBe('[unsupported content block: hologram]');
  });

  test('no content is a placeholder, not an empty string', () => {
    expect(renderContent([])).toBe(EMPTY_RESULT);
    expect(renderContent(undefined)).toBe(EMPTY_RESULT);
    expect(EMPTY_RESULT).not.toBe('');
  });

  test('something that is not a block list is JSON, not lost', () => {
    expect(renderContent({ answer: 42 })).toBe('{"answer":42}');
    expect(renderContent([1])).toBe('1');
  });
});

describe('renderResult', () => {
  test('reads the content blocks of an ordinary result', () => {
    expect(renderResult({ content: [{ type: 'text', text: 'hi' }], isError: false })).toBe('hi');
  });

  test('a result with only structuredContent shows its JSON, not "(no content)"', () => {
    expect(renderResult({ content: [], structuredContent: { rows: 2 } })).toBe('{"rows":2}');
  });

  test('content wins over structuredContent when both are present', () => {
    expect(
      renderResult({ content: [{ type: 'text', text: 'text copy' }], structuredContent: { a: 1 } }),
    ).toBe('text copy');
  });

  test('the SDK’s legacy toolResult shape is read as content', () => {
    expect(renderResult({ toolResult: [{ type: 'text', text: 'legacy' }] })).toBe('legacy');
    expect(renderResult({})).toBe(EMPTY_RESULT);
  });
});

describe('collect', () => {
  test('follows the cursor to the last page and keeps the order', async () => {
    const pages = new Map<string | undefined, { items: number[]; next: string | undefined }>([
      [undefined, { items: [1, 2], next: 'b' }],
      ['b', { items: [3], next: 'c' }],
      ['c', { items: [4, 5], next: undefined }],
    ]);
    const seen: (string | undefined)[] = [];
    const all = await Effect.runPromise(
      collect('listTools', 'https://mcp.test/mcp', async (cursor) => {
        seen.push(cursor);
        return pages.get(cursor) ?? { items: [], next: undefined };
      }),
    );
    expect(all).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual([undefined, 'b', 'c']);
  });

  test(`a server that never ends its pages is refused after ${String(MAX_PAGES)}`, async () => {
    let calls = 0;
    const error = await Effect.runPromise(
      collect('listTools', 'https://mcp.test/mcp', async () => {
        calls += 1;
        return { items: [calls], next: 'again' };
      }).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(McpToolkitError);
    expect(error.message).toContain('more than 100 pages');
    expect(calls).toBe(MAX_PAGES);
  });

  test('a page that throws is an McpToolkitError naming the operation and server', async () => {
    const error = await Effect.runPromise(
      collect('listResources', 'https://mcp.test/mcp', async () => {
        throw new Error('boom');
      }).pipe(Effect.flip),
    );
    expect(error).toMatchObject({
      _tag: 'McpToolkitError',
      operation: 'listResources',
      server: 'https://mcp.test/mcp',
    });
    expect(error.message).toContain('boom');
  });
});
