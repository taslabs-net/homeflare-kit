/**
 * Generated from LiteLLM 1.100.0's OpenAPI document -- DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/litellm.ts    (`--check` compares without writing)
 * Manifest entry: `litellm-openapi` -- LiteLLM Proxy (app.openapi()) 1.100.0
 *   sha256 1b3e4d23da6aea92..., read from codegen/manifest.json's own note on how this document
 *   was produced (the vendor's own generator, cross-checked byte-identically — not a live read).
 *
 * Covers the 4 pass-through operations this package writes to:
 *   litellm:DELETE /config/pass_through_endpoint
 *   litellm:GET /config/pass_through_endpoint
 *   litellm:POST /config/pass_through_endpoint
 *   litellm:POST /config/pass_through_endpoint/{endpoint_id}
 *
 * Does NOT cover the other 692 paths LiteLLM 1.100.0 publishes — this generator is
 * consumer-driven (codegen/litellm.ts), not exhaustive. See codegen/README.md.
 */

export interface PassThroughEndpointResponse {
  readonly endpoints: readonly PassThroughGenericEndpoint[];
}

export interface PassThroughGenericEndpoint {
  /**
   * Whether authentication is required for the pass-through endpoint. Defaults to True so a pass-through silently created without an explicit value still requires a valid LiteLLM API key — set to False only if the endpoint is meant to be a public forwarder (e.g. an unauthenticated webhook target).
   * @default true
   */
  readonly auth?: boolean;
  /**
   * The USD cost per request to the target endpoint. This is used to calculate the cost of the request to the target endpoint.
   * @default 0
   */
  readonly cost_per_request?: number;
  /**
   * Key-value pairs of default query parameters to be sent with every request to this endpoint. These can be overridden by client-provided query parameters. For example: {'key': 'default_value', 'api_version': '2023-01'}
   * @default {}
   */
  readonly default_query_params?: Record<string, unknown>;
  /** Guardrails configuration for this passthrough endpoint. Dict keys are guardrail names, values are optional settings for field targeting. When set, all org/team/key level guardrails will also execute. Defaults to None (no guardrails execute). */
  readonly guardrails?: Record<string, PassThroughGuardrailSettings | null> | null;
  /**
   * Key-value pairs of headers to be forwarded with the request. You can set any key value pair here and it will be forwarded to your target endpoint
   * @default {}
   */
  readonly headers?: Record<string, unknown>;
  /** Optional unique identifier for the pass-through endpoint. If not provided, endpoints will be identified by path for backwards compatibility. */
  readonly id?: string | null;
  /**
   * If True, requests to subpaths of the path will be forwarded to the target endpoint. For example, if the path is /bria and include_subpath is True, requests to /bria/v1/text-to-image/base/2.3 will be forwarded to the target endpoint.
   * @default false
   */
  readonly include_subpath?: boolean;
  /**
   * True if this endpoint is defined in the config file, False if from DB. Config-defined endpoints cannot be edited via the UI.
   * @default false
   */
  readonly is_from_config?: boolean;
  /** List of HTTP methods this endpoint handles (e.g., ['GET', 'POST']). If None or empty, all methods (GET, POST, PUT, DELETE, PATCH) are supported for backward compatibility. This allows the same path to have different targets for different HTTP methods. */
  readonly methods?: readonly string[] | null;
  /** The route to be added to the LiteLLM Proxy Server. */
  readonly path: string;
  /** The URL to which requests for this path should be forwarded. */
  readonly target: string;
  /** Upstream request timeout in seconds for this pass-through endpoint. If unset, uses general_settings.pass_through_request_timeout (default 600). */
  readonly timeout?: number | null;
}

export interface PassThroughGuardrailSettings {
  /** JSONPath expressions for input field targeting (pre_call). Examples: 'query', 'documents[*].text', 'messages[*].content'. If not specified, guardrail runs on entire request payload. */
  readonly request_fields?: readonly string[] | null;
  /** JSONPath expressions for output field targeting (post_call). Examples: 'results[*].text', 'output'. If not specified, guardrail runs on entire response payload. */
  readonly response_fields?: readonly string[] | null;
}
