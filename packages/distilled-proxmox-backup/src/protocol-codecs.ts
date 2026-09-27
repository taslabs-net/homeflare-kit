/**
 * PBS 4.2.6-1's form arrays and successful response validation.
 *
 * The vendor's array parameters are repeated keys (`target=a&target=b`), not the Stripe
 * bracket-index encoding used by core's generic REST builder. Measured against the PBS
 * notification provider's existing protocol fixtures, 2026-09-24: indexed headers/secrets
 * disappear from its read-back, and matchers perpetually drift. Preserve core path/auth/key
 * mapping and adapt only its top-level indexed form fields at this vendor boundary.
 */
import * as API from "@distilled.cloud/core/api";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { ProxmoxBackupParseError } from "./errors.ts";

const repeatedFormKeys = (request: HttpClientRequest.HttpClientRequest) => {
  if (
    request.body._tag !== "Uint8Array" ||
    request.body.contentType !== "application/x-www-form-urlencoded"
  )
    return request;
  const fields = new URLSearchParams(
    new TextDecoder().decode(request.body.body),
  );
  const repeated: [string, string][] = [];
  for (const [key, value] of fields) {
    repeated.push([key.replace(/^([^\[\]]+)\[\d+\]$/, "$1"), value]);
  }
  return HttpClientRequest.bodyUrlParams(request, repeated);
};

/**
 * Core REST decode maps wire keys but does not validate required fields. In particular,
 * PBS data:null unwrapped to {} used to look like a real resource to a caller. Validate
 * with the operation's generated schema: Unit operations still accept {}, while a GET
 * missing its required name/id fails. Preserve the mapped payload after validation: vendor
 * fields absent from the published schema must not silently disappear. Core has already
 * decoded the payload, so validate the schema's Type side instead of re-decoding transforms.
 * Keep server data out of the parse error: notification responses can contain header
 * credentials, and a schema diagnostic can reproduce them.
 */
export const withPbsCodecs = (
  base: Layer.Layer<API.Protocol>,
): Layer.Layer<API.Protocol> =>
  Layer.effect(
    API.Protocol,
    Effect.gen(function* () {
      const protocol = yield* API.Protocol;
      return API.Protocol.of({
        encode: (args) =>
          protocol.encode(args).pipe(Effect.map(repeatedFormKeys)),
        decode: (args) =>
          protocol.decode(args).pipe(
            Effect.flatMap((body) =>
              args.config.output === undefined
                ? Effect.succeed(body)
                : (Schema.decodeUnknownEffect(
                    Schema.toType(args.config.output),
                  )(body).pipe(
                    Effect.as(body),
                    Effect.mapError(
                      () =>
                        new ProxmoxBackupParseError({
                          body: undefined,
                          cause:
                            "Response does not match the operation's declared output schema",
                        }),
                    ),
                  ) as Effect.Effect<unknown>),
            ),
          ),
      });
    }),
  ).pipe(Layer.provide(base));
