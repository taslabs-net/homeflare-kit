/** Read-only PBS wire measurements, 2026-09-24: missing config items use plain-text 400. */
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import type { ProxmoxBackupOpContext } from "./protocol.ts";
import * as Retry from "./retry.ts";
import * as config from "./services/config.ts";

const testCredentials = credentials({
  tokenId: "backup@pbs!test",
  secret: "test-secret",
  baseUrl: "https://pbs.test:8007",
});
const failure = (
  op: Effect.Effect<unknown, unknown, ProxmoxBackupOpContext>,
  status: number,
  body: string,
) =>
  Effect.runPromise(
    op.pipe(
      Retry.none,
      Effect.provide(
        Layer.mergeAll(
          testCredentials,
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response(body, { status }),
                ),
              ),
            ),
          ),
        ),
      ),
      Effect.flip,
    ),
  );
const absent = "hf-absent-sdk-0924";
const cases = [
  {
    op: config.getConfigDatastore({ name: absent }),
    kind: "datastore",
    tag: "DatastoreNotFound",
  },
  {
    op: config.getConfigPrune({ id: absent }),
    kind: "prune",
    tag: "PruneJobNotFound",
  },
  {
    op: config.getConfigSync({ id: absent }),
    kind: "sync",
    tag: "SyncJobNotFound",
  },
  {
    op: config.getConfigVerify({ id: absent }),
    kind: "verification",
    tag: "VerifyJobNotFound",
  },
] as const;

describe("PBS resource absence", () => {
  for (const { op, kind, tag } of cases) {
    test(`${kind}: exact measured 400 is a typed missing resource`, async () => {
      expect(
        await failure(op, 400, `no such ${kind} '${absent}'`),
      ).toMatchObject({ _tag: tag });
    });
    test(`${kind}: a different status, kind or extended error is not absence`, async () => {
      for (const [status, body] of [
        [403, `no such ${kind} '${absent}'`],
        [500, `no such ${kind} '${absent}'`],
        [400, "no such unrelated 'id'"],
        [400, `no such ${kind} '${absent}': configuration unreadable`],
        [400, "parameter verification failed"],
      ] as const) {
        expect(await failure(op, status, body)).not.toMatchObject({
          _tag: tag,
        });
      }
    });
  }
  test("missing text is scoped to the named GET operation", async () => {
    expect(
      await failure(
        config.listConfigDatastore({}),
        400,
        `no such datastore '${absent}'`,
      ),
    ).not.toMatchObject({ _tag: "DatastoreNotFound" });
  });
});
