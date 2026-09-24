/**
 * WI-1's runtime half: `convert-endpoint.test.ts` proves the Smithy model
 * binds a DELETE's non-label params to the query string; this file proves
 * the generated, wire-level request actually built from that model does
 * the same — a real `DeleteNodeCephFs` call must produce `?remove-pools=1`
 * in the URL and carry NO body. Before the WI-1 fix, `remove_pools` was a
 * body member on a form-urlencoded DELETE, which PVE's server silently
 * ignores (`errors.ts`'s header cites the measurement).
 */
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import * as Retry from "./retry.ts";
import { deleteNodeCephFs } from "./services/nodes.ts";

const testCredentials = credentials({
  tokenId: "root@pam!test",
  secret: "test-secret",
  baseUrl: "https://pve.test:8006",
});

describe("DeleteNodeCephFs — non-label params are query, not body (WI-1)", () => {
  test("?remove-pools=1 is in the URL; the request body is empty", async () => {
    let capturedUrl: string | undefined;
    let capturedBodyTag: string | undefined;
    const fakePve = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          capturedUrl = request.url;
          capturedBodyTag = request.body._tag;
          return HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify({ data: "UPID:pve1:task" }), {
              status: 200,
            }),
          );
        }),
      ),
    );

    await Effect.runPromise(
      deleteNodeCephFs({
        node: "pve1",
        name: "cephfs1",
        remove_pools: "1",
      }).pipe(
        Retry.none,
        Effect.provide(Layer.mergeAll(fakePve, testCredentials)),
      ),
    );

    expect(capturedUrl).toBeDefined();
    const url = new URL(capturedUrl!);
    expect(url.pathname).toBe("/api2/json/nodes/pve1/ceph/fs/cephfs1");
    expect(url.searchParams.get("remove-pools")).toBe("1");
    // No body member remains on the request at all (`remove_storages` was
    // omitted from this call), so there is nothing to form-urlencode — the
    // WI-1 bug would have made this "Raw" (a form-urlencoded body) instead.
    expect(capturedBodyTag).toBe("Empty");
  });
});
