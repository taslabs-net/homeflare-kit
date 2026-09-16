/**
 * ★ RFC 9728 discovery. The MCP spec REQUIRES a server to publish it and a client to use
 *   it; without it a client cannot begin the OAuth flow at all.
 */
import { describe, expect, test } from 'bun:test';
import {
  protectedResourceMetadata,
  serveMcpMetadata,
  unauthorizedResponse,
  wellKnownPath,
} from '../src/mcp-metadata.ts';

const opts = {
  resource: 'https://mcp.example.com/mcp',
  authorizationServer: 'https://team.cloudflareaccess.com',
};

describe('wellKnownPath', () => {
  test('keeps the resource path AFTER the well-known segment', () => {
    // ⚠️ Serving at the root instead makes a multi-resource server advertise one
    //   resource's metadata for all of them.
    expect(wellKnownPath('https://mcp.example.com/mcp')).toBe(
      '/.well-known/oauth-protected-resource/mcp',
    );
  });

  test('a root resource has no trailing segment', () => {
    expect(wellKnownPath('https://mcp.example.com')).toBe('/.well-known/oauth-protected-resource');
    expect(wellKnownPath('https://mcp.example.com/')).toBe('/.well-known/oauth-protected-resource');
  });
});

describe('protectedResourceMetadata', () => {
  test('names the resource and its authorization server', () => {
    const doc = protectedResourceMetadata(opts);

    expect(doc.resource).toBe(opts.resource);
    expect(doc.authorization_servers).toEqual([opts.authorizationServer]);
  });

  test('advertises header-only bearer methods', () => {
    // ⚠️ A token in a query string lands in access logs and in Referer.
    expect(protectedResourceMetadata(opts).bearer_methods_supported).toEqual(['header']);
  });

  test('omits optional fields rather than emitting undefined', () => {
    // ⚠️ Through unknown: a readonly interface does not overlap an index signature, and
    //   the point here is to inspect KEY PRESENCE rather than the typed shape.
    const doc = protectedResourceMetadata(opts) as unknown as Record<string, unknown>;
    expect('scopes_supported' in doc).toBe(false);
  });
});

describe('unauthorizedResponse', () => {
  test('points at the metadata document, which is the entire point', async () => {
    // ⛔ A bare `WWW-Authenticate: Bearer` tells a client it needs a token but not where
    //   to get one — discovery dead-ends.
    const res = unauthorizedResponse(opts);

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
    );
  });
});

describe('serveMcpMetadata', () => {
  test('serves the document at its derived path', async () => {
    const res = serveMcpMetadata(
      new Request('https://mcp.example.com/.well-known/oauth-protected-resource/mcp'),
      opts,
    );

    expect(res).toBeDefined();
    const body = (await res?.json()) as { resource: string };
    expect(body.resource).toBe(opts.resource);
  });

  test('returns undefined for any other path, so it composes in a handler', () => {
    expect(serveMcpMetadata(new Request('https://mcp.example.com/mcp'), opts)).toBeUndefined();
  });

  test('is CORS-open, because a client reads it before it has a token', () => {
    // ⚠️ Often from a browser origin the server has never seen. Locking it down breaks
    //   the flow it exists to start.
    const res = serveMcpMetadata(
      new Request('https://mcp.example.com/.well-known/oauth-protected-resource/mcp'),
      opts,
    );

    expect(res?.headers.get('access-control-allow-origin')).toBe('*');
  });
});
