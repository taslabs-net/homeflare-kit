import { describe, expect, test } from 'bun:test';
import { z } from '@hono/zod-openapi';
import { createOpenApiApp, readableZodError } from '../src/openapi.ts';

describe('readableZodError', () => {
  test('names the field', () => {
    const parsed = z.object({ title: z.string() }).safeParse({ title: 1 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(readableZodError(parsed.error)).toContain('title');
  });

  test('names unknown keys', () => {
    const parsed = z.object({ title: z.string() }).strict().safeParse({ title: 'ok', extra: 1 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(readableZodError(parsed.error)).toContain('extra');
  });
});

describe('createOpenApiApp', () => {
  test('is an OpenAPIHono with fetch', () => {
    const app = createOpenApiApp();
    expect(typeof app.fetch).toBe('function');
    expect(typeof app.doc).toBe('function');
  });

  test('refuses an unrecognised key by default', async () => {
    const app = createOpenApiApp();
    app.post('/', async (c) => {
      const body = await c.req.json();
      const parsed = z.object({ title: z.string() }).strict().safeParse(body);
      if (!parsed.success) return c.json({ error: readableZodError(parsed.error) }, 400);
      return c.json(parsed.data);
    });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'ok', extra: true }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('extra');
  });
});
