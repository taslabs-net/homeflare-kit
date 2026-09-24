/**
 * Caddy SDK trait surface — hand-written.
 *
 * Re-exports the generic protocol traits from core so generated operations
 * import everything from one place (`import * as T from "../traits.ts"`,
 * `T.Label()`, `T.HttpBody()`, …). Caddy has no bearer auth and no
 * pagination of its own; the only provider-specific trait it needs is the
 * bare-array response wrapper (`GetReverseProxyUpstreams`) — same one
 * Forgejo uses for its bare-array list endpoints.
 */
export {
  Body,
  Header,
  Query,
  Label,
  Http,
  ResponseCode,
  HttpBody,
  KeyDictionary,
  type HttpTrait,
  bodySymbol,
  headerSymbol,
  querySymbol,
  labelSymbol,
  httpSymbol,
  responseCodeSymbol,
  httpBodySymbol,
  keyDictionarySymbol,
} from "@distilled.cloud/core/trait";

// Bare-payload response wrapper (`GET /reverse_proxy/upstreams` answers a
// bare JSON array, no wrapping object).
export {
  RawResponse,
  RawResponseRoot,
  rawResponseSymbol,
  rawResponseRootSymbol,
} from "@distilled.cloud/core/protocol-rest";
