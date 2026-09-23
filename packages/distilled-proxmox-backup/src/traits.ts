/**
 * Proxmox Backup Server SDK trait surface — hand-written.
 *
 * Copied unchanged from `packages/proxmox/src/traits.ts`. Re-exports the
 * generic protocol traits from core so generated operations import
 * everything from one place. PBS speaks form-urlencoded/query REST with a
 * `{"data": …}` envelope and no bare-array response bodies of its own
 * shape beyond what `RawResponse`/`RawResponseRoot` already cover (see
 * `scripts/convert.ts`'s header), so there are no PBS-specific traits.
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

// Bearer-REST protocol traits (bare-payload responses; PBS has no
// sensitive-member marking today — every generated member is plain).
export {
  RawResponse,
  RawResponseRoot,
  rawResponseSymbol,
  rawResponseRootSymbol,
} from "@distilled.cloud/core/protocol-rest";
