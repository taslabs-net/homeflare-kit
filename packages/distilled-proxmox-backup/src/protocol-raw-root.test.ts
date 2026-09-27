import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import type { ProxmoxBackupOpContext } from "./protocol.ts";
import * as Retry from "./retry.ts";
import {
  deleteConfigDatastore,
  getConfigAcmeTos,
  listConfigDatastore,
} from "./services/config.ts";

const run = <A, E>(
  operation: Effect.Effect<A, E, ProxmoxBackupOpContext>,
  data: unknown,
) =>
  Effect.runPromise(
    operation.pipe(
      Retry.none,
      Effect.provide(
        Layer.mergeAll(
          credentials({
            baseUrl: "https://pbs.test:8007",
            tokenId: "test@pbs!fake",
            secret: "fake-not-real",
          }),
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(request, Response.json({ data })),
              ),
            ),
          ),
        ),
      ),
    ),
  );

test("raw-root string responses retain task IDs and ACME terms URLs", async () => {
  const upid =
    "UPID:pbs:00000001:00000002:00000003:delete-datastore:test:root@pam:";
  expect(await run(deleteConfigDatastore({ name: "test" }), upid)).toBe(upid);
  const url = "https://acme.test/terms";
  expect(await run(getConfigAcmeTos({}), url)).toBe(url);
});

test("raw-root lists retain empty lists, map wire keys, and preserve extra fields", async () => {
  expect(await run(listConfigDatastore({}), [])).toEqual([]);
  const expected = [
    { name: "test", path: "/backup/test", keep_last: 2, future_field: "keep" },
  ];
  expect(
    await run(listConfigDatastore({}), [
      {
        name: "test",
        path: "/backup/test",
        "keep-last": 2,
        future_field: "keep",
      },
    ]),
  ).toEqual(expected);
});

// These operations are not Unit responses: null must not become a valid empty object.
for (const data of [null, {}]) {
  test(`raw-root operations reject ${JSON.stringify(data)} instead of accepting missing output`, async () => {
    const operations: Effect.Effect<
      unknown,
      unknown,
      ProxmoxBackupOpContext
    >[] = [
      deleteConfigDatastore({ name: "test" }),
      getConfigAcmeTos({}),
      listConfigDatastore({}),
    ];
    for (const operation of operations) {
      const error = await run(Effect.flip(operation), data);
      expect(error).toMatchObject({ _tag: "ProxmoxBackupParseError" });
    }
  });
}
