/**
 * LiteLLM SDK trait surface — hand-written.
 *
 * Re-exports the generic protocol traits from core so generated operations
 * import everything from one place. LiteLLM speaks plain bearer-REST JSON
 * with per-resource envelopes (decoded by each operation's own schema), so
 * there are no provider-specific traits — same as Forgejo, minus the
 * `RawResponse`/`RawResponseRoot` traits Forgejo needs for its bare-array
 * list responses: every LiteLLM list endpoint this package's tag split
 * covers wraps its rows in a named object field instead.
 */
export {
  Body,
  Header,
  Query,
  Label,
  Http,
  ResponseCode,
  HttpBody,
  FormDataFile,
  KeyDictionary,
  UnionCases,
  applyErrorMatchers,
  getErrorMatchers,
  type HttpTrait,
  type ErrorMatcher,
  bodySymbol,
  headerSymbol,
  querySymbol,
  labelSymbol,
  httpSymbol,
  responseCodeSymbol,
  httpBodySymbol,
  formDataFileSymbol,
  keyDictionarySymbol,
  unionCasesSymbol,
  errorMatchersSymbol,
} from "@distilled.cloud/core/trait";

// Bearer-REST protocol traits (sensitive strings).
export {
  SensitiveValue,
  sensitiveValueSymbol,
} from "@distilled.cloud/core/protocol-rest";
