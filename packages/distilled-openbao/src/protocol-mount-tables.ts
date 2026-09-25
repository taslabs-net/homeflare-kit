/**
 * The auth/mount inventories require a data map (OpenBao v2.6.2
 * vault/logical_system.go:930-959,2108-2134; api/v2 sys_{auth,mounts}.go).
 * A missing envelope must never masquerade as an empty table and authorize
 * a consumer's create. Other logical, health and login shapes are separate.
 */
import * as API from "@distilled.cloud/core/api";
import { getAnn } from "@distilled.cloud/core/protocol-http";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { OpenBaoParseError } from "./errors.ts";
import { mountTableSymbol } from "./traits.ts";

const invalidTable = () =>
  new OpenBaoParseError({
    body: undefined,
    cause: "Response does not match the declared OpenBao mount table schema",
  });
const record = (body: unknown): body is Record<string, unknown> =>
  typeof body === "object" && body !== null && !Array.isArray(body);

export const withMountTables = (
  base: Layer.Layer<API.Protocol>,
): Layer.Layer<API.Protocol> =>
  Layer.effect(
    API.Protocol,
    Effect.gen(function* () {
      const protocol = yield* API.Protocol;
      return API.Protocol.of({
        encode: protocol.encode,
        decode: (args) => {
          if (
            !getAnn(args.outputAst, mountTableSymbol) ||
            args.response.status >= 400 ||
            args.config.output === undefined
          )
            return protocol.decode(args);
          // These schemas use wire names and contain no sensitive transforms.
          // Validate the original envelope before core's empty-body fallback;
          // retain unknown metadata after validation for forward compatibility.
          // Neither body values nor schema diagnostics may enter parse errors.
          const output = args.config.output;
          return args.response.json.pipe(
            Effect.mapError(invalidTable),
            Effect.flatMap((envelope) =>
              record(envelope) && record(envelope.data)
                ? Schema.decodeUnknownEffect(Schema.toType(output))(
                    envelope.data,
                  ).pipe(
                    Effect.as(envelope.data),
                    Effect.mapError(invalidTable),
                  )
                : Effect.fail(invalidTable()),
            ),
          ) as Effect.Effect<unknown>;
        },
      });
    }),
  ).pipe(Layer.provide(base));
