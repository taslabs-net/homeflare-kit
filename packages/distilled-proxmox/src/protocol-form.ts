/**
 * PVE's form arrays use repeated keys, never Stripe's indexed fields.
 *
 * PVE 9.2.11 notification schemas declare arrays (mailto, header, target,
 * match-field, delete). The vendor UI submits repeated keys; its Perl
 * URL-encoded decoder joins them with NUL before schema validation. The
 * existing kit notification-target-form.ts records that decoder/UI evidence
 * (2026-09-14); no production multi-header write was made for this fix.
 *
 * Keep core's credentials, labels, schema key mapping, and query encoding.
 * Only top-level scalar list entries in a form body change: header[0]=a
 * becomes header=a. A property-string item's commas remain inside the item.
 * A scalar comma list, an embedded NUL, or a GET/DELETE query is unchanged.
 */
import * as API from "@distilled.cloud/core/api";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

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

export const withPveFormArrays = (
  base: Layer.Layer<API.Protocol>,
): Layer.Layer<API.Protocol> =>
  Layer.effect(
    API.Protocol,
    Effect.gen(function* () {
      const protocol = yield* API.Protocol;
      return API.Protocol.of({
        ...protocol,
        encode: (args) =>
          protocol.encode(args).pipe(Effect.map(repeatedFormKeys)),
      });
    }),
  ).pipe(Layer.provide(base));
