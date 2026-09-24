import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import * as Retry from "./retry.ts";
import { policiesDeleteAclPolicy } from "./services/policies.ts";

for (const token of [undefined, "", "test-token"]) {
  test(`agent request header is present; ${token ? "nonempty" : "absent or empty"} token has correct header semantics`, async () => {
    const client = HttpClient.make((request) => {
      expect(request.headers["x-vault-request"]).toBe("true");
      if (token) expect(request.headers["x-vault-token"]).toBe(token);
      else expect(request.headers["x-vault-token"]).toBeUndefined();
      expect(request.headers["x-vault-namespace"]).toBeUndefined();
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(null, { status: 204 }),
        ),
      );
    });
    await Effect.runPromise(
      policiesDeleteAclPolicy({ name: "test" }).pipe(
        Retry.none,
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(HttpClient.HttpClient, client),
            credentials({ addr: "http://fake.invalid", token }),
          ),
        ),
      ),
    );
  });
}

test("every status mapped by the protocol is represented in the operation error union", async () => {
  // These catchTag calls must compile: core DEFAULT_ERRORS excludes both tags,
  // but OpenBaoProtocol's default HTTP_STATUS_MAP emits them for every operation.
  for (const status of [403, 404]) {
    const client = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({ errors: [] }, { status }),
        ),
      ),
    );
    const tag = await Effect.runPromise(
      policiesDeleteAclPolicy({ name: "test" }).pipe(
        Retry.none,
        Effect.as("success"),
        Effect.catchTag("Forbidden", () => Effect.succeed("Forbidden")),
        Effect.catchTag("NotFound", () => Effect.succeed("NotFound")),
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(HttpClient.HttpClient, client),
            credentials({ addr: "http://fake.invalid", token: "test-token" }),
          ),
        ),
      ),
    );
    expect(tag).toBe(status === 403 ? "Forbidden" : "NotFound");
  }
});
