/** The PBS adapter preserves core's decoded-value and nested-form contracts. */
import { expect, test } from "bun:test";
import * as API from "@distilled.cloud/core/api";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { withPbsCodecs } from "./protocol-codecs.ts";

const request = HttpClientRequest.post("https://pbs.test/config").pipe(
  HttpClientRequest.bodyUrlParams([
    ["target[0]", "mail"],
    ["target[1]", "hook"],
    ["nested[targets][0]", "keep"],
    ["scalar", "a,b"],
  ]),
);
const base = Layer.succeed(
  API.Protocol,
  API.Protocol.of({
    encode: () => Effect.succeed(request),
    decode: () => Effect.succeed(42),
  }),
);
const protocol = withPbsCodecs(base);

test("only top-level indexed form lists change", async () => {
  const encoded = await Effect.runPromise(
    Effect.gen(function* () {
      const adapter = yield* API.Protocol;
      return yield* adapter.encode({
        input: {},
        inputAst: Schema.Unknown.ast,
        config: {},
      });
    }).pipe(Effect.provide(protocol)),
  );
  expect(encoded.body._tag).toBe("Uint8Array");
  if (encoded.body._tag !== "Uint8Array") return;
  const form = new URLSearchParams(new TextDecoder().decode(encoded.body.body));
  expect(form.getAll("target")).toEqual(["mail", "hook"]);
  expect(form.get("nested[targets][0]")).toBe("keep");
  expect(form.get("scalar")).toBe("a,b");
});

test("core-decoded output is validated on the Type side without decoding twice", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const adapter = yield* API.Protocol;
      return yield* adapter.decode({
        response: HttpClientResponse.fromWeb(request, new Response("42")),
        outputAst: Schema.NumberFromString.ast,
        config: { output: Schema.NumberFromString },
        errors: [],
      });
    }).pipe(Effect.provide(protocol)),
  );
  expect(result).toBe(42);
});
