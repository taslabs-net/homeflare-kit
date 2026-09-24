/**
 * STUB — Traefik trait surface. Re-exports core protocol traits so the stub
 * operation (and a future generate+copy) import everything from one place.
 */
export {
  Body,
  Header,
  Http,
  HttpBody,
  KeyDictionary,
  Label,
  Query,
  ResponseCode,
  bodySymbol,
  headerSymbol,
  httpBodySymbol,
  httpSymbol,
  keyDictionarySymbol,
  labelSymbol,
  querySymbol,
  responseCodeSymbol,
  type HttpTrait,
} from '@distilled.cloud/core/trait';

export {
  RawResponse,
  RawResponseRoot,
  rawResponseRootSymbol,
  rawResponseSymbol,
} from '@distilled.cloud/core/protocol-rest';
