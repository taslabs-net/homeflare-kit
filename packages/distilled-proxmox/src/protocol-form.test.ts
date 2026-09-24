/** PVE 9.2.11 schema arrays must survive the vendor's repeated-key decoder. */
import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import type { ProxmoxOpContext } from "./protocol.ts";
import * as Retry from "./retry.ts";
import * as cluster from "./services/cluster.ts";
import * as nodes from "./services/nodes.ts";

const capture = async <A, E>(op: Effect.Effect<A, E, ProxmoxOpContext>) => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  await Effect.runPromise(
    op.pipe(
      Retry.none,
      Effect.provide(
        credentials({
          baseUrl: "https://pve.test:8006",
          tokenId: "test@pve!test",
          secret: "fake",
        }),
      ),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            requests.push(request);
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json({ data: null }),
              ),
            );
          }),
        ),
      ),
    ),
  );
  const request = requests[0]!;
  const form =
    request.body._tag === "Uint8Array"
      ? new URLSearchParams(new TextDecoder().decode(request.body.body))
      : new URLSearchParams();
  return { request, form };
};

test("matcher arrays repeat the wire key; commas within a rule stay inside that item", async () => {
  const { request, form } = await capture(
    cluster.createClusterNotificationMatcher({
      name: "matcher",
      target: ["mail", "webhook"],
      match_field: ["exact:type=vzdump", "regex:hostname=one,two"],
    }),
  );
  expect(request.method).toBe("POST");
  expect(form.getAll("target")).toEqual(["mail", "webhook"]);
  expect(form.getAll("match-field")).toEqual([
    "exact:type=vzdump",
    "regex:hostname=one,two",
  ]);
  expect([...form.keys()].some((key) => key.includes("["))).toBe(false);
});

test("webhook property-string headers remain separate values", async () => {
  const headers = ["name=X-One,value=YQ==", "name=X-Two,value=Yg=="];
  const { form } = await capture(
    cluster.createClusterNotificationEndpointWebhook({
      name: "webhook",
      method: "post",
      url: "https://example.com/hook",
      header: headers,
    }),
  );
  expect(form.getAll("header")).toEqual(headers);
});

test("array delete fields repeat while scalar comma lists remain scalar", async () => {
  const { form } = await capture(
    cluster.putClusterNotificationMatcher({
      name: "matcher",
      delete: ["match-field", "match-calendar"],
    }),
  );
  expect(form.getAll("delete")).toEqual(["match-field", "match-calendar"]);
  const scalar = await capture(
    cluster.putClusterBackup({ id: "job", vmid: "100,101" }),
  );
  expect(scalar.form.getAll("vmid")).toEqual(["100,101"]);
});

test("DELETE stays bodyless and its flags stay query parameters", async () => {
  const { request, form } = await capture(
    nodes.deleteNodeCephFs({ node: "node", name: "fs", remove_pools: "1" }),
  );
  expect(request.method).toBe("DELETE");
  expect(request.body._tag).toBe("Empty");
  expect(new URL(request.url).searchParams.get("remove-pools")).toBe("1");
  expect([...form]).toEqual([]);
});
