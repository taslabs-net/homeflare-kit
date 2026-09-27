import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type { HttpClientRequest } from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import * as Retry from "./retry.ts";
import {
  getConfigNotificationMatcher,
  putConfigNotificationMatcher,
} from "./services/config.ts";

const credential = credentials({
  baseUrl: "https://pbs.test:8007",
  tokenId: "test@pbs!fake",
  secret: "fake-not-real",
});

const fakePbs = (body: unknown, see?: (request: HttpClientRequest) => void) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        see?.(request);
        return HttpClientResponse.fromWeb(
          request,
          Response.json({ data: body }),
        );
      }),
    ),
  );

test("PBS arrays use repeated keys and Unit data:null remains a successful write", async () => {
  let pairs: [string, string][] = [];
  const client = fakePbs(null, (request) => {
    expect(request.body._tag).toBe("Uint8Array");
    if (request.body._tag === "Uint8Array") {
      pairs = [
        ...new URLSearchParams(new TextDecoder().decode(request.body.body)),
      ];
    }
  });
  await Effect.runPromise(
    putConfigNotificationMatcher({
      name: "pager",
      target: ["mail-to-root", "hook"],
      delete: ["match-field", "match-calendar"],
    }).pipe(Retry.none, Effect.provide(Layer.mergeAll(client, credential))),
  );
  expect(pairs.filter(([key]) => key === "target")).toEqual([
    ["target", "mail-to-root"],
    ["target", "hook"],
  ]);
  expect(pairs.filter(([key]) => key === "delete")).toEqual([
    ["delete", "match-field"],
    ["delete", "match-calendar"],
  ]);
});

for (const body of [null, { comment: "secret-like-text-must-not-appear" }]) {
  test("incomplete resource output fails without exposing response contents", async () => {
    const error = await Effect.runPromise(
      getConfigNotificationMatcher({ name: "pager" }).pipe(
        Retry.none,
        Effect.flip,
        Effect.provide(Layer.mergeAll(fakePbs(body), credential)),
      ),
    );
    expect(error).toMatchObject({ _tag: "ProxmoxBackupParseError" });
    expect(JSON.stringify(error)).not.toContain(
      "secret-like-text-must-not-appear",
    );
  });
}

test("valid resource output preserves fields omitted from the vendor schema", async () => {
  const result = await Effect.runPromise(
    getConfigNotificationMatcher({ name: "pager" }).pipe(
      Retry.none,
      Effect.provide(
        Layer.mergeAll(
          fakePbs({ name: "pager", future_field: "keep-me" }),
          credential,
        ),
      ),
    ),
  );
  expect(result).toMatchObject({ name: "pager", future_field: "keep-me" });
});

test("mapped NotFound is in the operation's typed union, including a plain-text response", async () => {
  const client = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response("matcher 'pager' not found", { status: 404 }),
        ),
      ),
    ),
  );
  const result = await Effect.runPromise(
    getConfigNotificationMatcher({ name: "pager" }).pipe(
      Retry.none,
      Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
      Effect.provide(Layer.mergeAll(client, credential)),
    ),
  );
  expect(result).toBeUndefined();
});
