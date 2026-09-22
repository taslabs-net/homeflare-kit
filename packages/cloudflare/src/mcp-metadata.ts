/**
 * RFC 9728 discovery for an MCP server — the third auth path, and the one a client
 * actually needs to find its way in.
 *
 * ★ THE MCP SPEC REQUIRES THIS. A server MUST publish OAuth 2.0 Protected Resource
 *   Metadata, and a client MUST use it to discover the authorization server. Without it a
 *   client cannot begin the flow, and has to be told endpoints out of band — which is
 *   exactly the gap that leaves real servers (Atlassian's, measured 2026) undiscoverable
 *   by spec-compliant clients.
 *
 * ⛔ TWO HALVES, AND ONE ALONE DOES NOT WORK:
 *     1. `GET /.well-known/oauth-protected-resource` returns the metadata document.
 *     2. A 401 carries `WWW-Authenticate` naming that document's URL.
 *   A client may start from either. Publishing the document but answering a bare 401 leaves
 *   clients that follow the header — the common path — with nowhere to go.
 *
 * ⚠️ THE WELL-KNOWN URL IS DERIVED FROM THE RESOURCE URL, NOT CHOSEN. That derivation is a
 *   security property, not a convention: it stops an attacker publishing metadata that
 *   claims to describe a resource it has no authority over.
 *
 * ★ NO I/O AT MODULE SCOPE. Everything here is pure, because a Worker cannot make network
 *   calls during module initialization — a metadata helper that fetched at import would
 *   fail on the edge and nowhere else.
 */

/** The subset of RFC 9728 an MCP server needs. Extra fields pass through untouched. */
export interface ProtectedResourceMetadata {
  /** The resource's own canonical URL. ⛔ Must match what clients call, exactly. */
  readonly resource: string;
  /** Authorization servers that issue tokens for it. */
  readonly authorization_servers: readonly string[];
  readonly scopes_supported?: readonly string[];
  readonly bearer_methods_supported?: readonly string[];
  readonly resource_documentation?: string;
}

export interface McpMetadataOptions {
  /** The MCP endpoint clients call, e.g. `https://mcp.example.com/mcp`. */
  readonly resource: string;
  /**
   * The issuer. For Cloudflare's managed OAuth this is your team domain,
   * `https://<team>.cloudflareaccess.com`.
   */
  readonly authorizationServer: string;
  readonly scopes?: readonly string[];
  readonly documentation?: string;
}

/**
 * The well-known path for a resource URL, derived per RFC 9728.
 *
 * ⚠️ A RESOURCE WITH A PATH KEEPS IT, AFTER the well-known segment:
 *     https://example.com/mcp → /.well-known/oauth-protected-resource/mcp
 *   Serving it at the root instead is the mistake that makes a multi-resource server
 *   advertise one resource's metadata for all of them.
 */
export function wellKnownPath(resource: string): string {
  const path = new URL(resource).pathname.replace(/\/+$/, '');
  return path === ''
    ? '/.well-known/oauth-protected-resource'
    : `/.well-known/oauth-protected-resource${path}`;
}

/** Build the metadata document. Pure — no I/O, safe at module scope. */
export function protectedResourceMetadata(options: McpMetadataOptions): ProtectedResourceMetadata {
  return {
    resource: options.resource,
    authorization_servers: [options.authorizationServer],
    // ⚠️ `header` only. A bearer token in a query string lands in access logs and in
    //   Referer, and RFC 6750 discourages it for exactly that reason.
    bearer_methods_supported: ['header'],
    ...(options.scopes === undefined ? {} : { scopes_supported: options.scopes }),
    ...(options.documentation === undefined
      ? {}
      : { resource_documentation: options.documentation }),
  };
}

/**
 * The 401 an unauthenticated MCP request must receive.
 *
 * ⛔ THE `resource_metadata` PARAMETER IS THE WHOLE POINT. A bare `WWW-Authenticate:
 *   Bearer` tells a client it needs a token but not where to get one, so discovery dead-ends
 *   and the client falls back to hardcoded endpoints — or fails.
 */
export function unauthorizedResponse(options: McpMetadataOptions): Response {
  const metadataUrl = new URL(wellKnownPath(options.resource), options.resource).href;

  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': `Bearer resource_metadata="${metadataUrl}"`,
    },
  });
}

/**
 * Serve the metadata document when the request is for it, otherwise `undefined`.
 *
 * ```ts
 * const discovery = serveMcpMetadata(request, { resource, authorizationServer });
 * if (discovery !== undefined) return discovery;
 * ```
 *
 * ⚠️ CORS IS OPEN HERE ON PURPOSE. Discovery metadata is public by definition — a client
 *   must read it BEFORE it has a token, often from a browser origin the server has never
 *   seen. Locking it down breaks the flow it exists to start.
 */
export function serveMcpMetadata(
  request: Request,
  options: McpMetadataOptions,
): Response | undefined {
  const url = new URL(request.url);
  if (url.pathname !== wellKnownPath(options.resource)) return undefined;

  return new Response(JSON.stringify(protectedResourceMetadata(options), null, 2), {
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600',
    },
  });
}
