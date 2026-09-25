/**
 * OpenBao SDK trait surface — hand-written.
 *
 * Re-exports the generic protocol traits from core so generated operations
 * import everything from one place. OpenBao speaks plain token-REST JSON
 * with a `data`-enveloped success body (unwrapped in `protocol.ts`), so
 * MountTable marks the two inventory responses whose data is a path-keyed map.
 */
import { makeAnnotation } from "@distilled.cloud/core/trait";

export const mountTableSymbol = Symbol.for(
  "@distilled.cloud/openbao/mount-table",
);
/** A typed dynamic map inside a required logical-response data envelope. */
export const MountTable = () => makeAnnotation(mountTableSymbol, true);

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

// Bearer-REST protocol traits (sensitive strings, bare-payload responses).
export {
  SensitiveValue,
  RawResponse,
  RawResponseRoot,
  sensitiveValueSymbol,
  rawResponseSymbol,
  rawResponseRootSymbol,
} from "@distilled.cloud/core/protocol-rest";
