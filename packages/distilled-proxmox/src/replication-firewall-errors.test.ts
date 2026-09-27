/** Exact vendor exceptions at the real protocol boundary; source provenance is in patches. */
import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import type { ProxmoxOpContext } from "./protocol.ts";
import * as Retry from "./retry.ts";
import * as cluster from "./services/cluster.ts";

const call = <A, E>(
  op: Effect.Effect<A, E, ProxmoxOpContext>,
  status: number,
  body: unknown,
) =>
  Effect.runPromise(
    op.pipe(
      Retry.none,
      Effect.provide(
        credentials({
          baseUrl: "https://pve.test:8006",
          tokenId: "test@pve!test",
          secret: "fake",
        }),
      ),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json(body, { status }),
            ),
          ),
        ),
      ),
      Effect.flip,
    ),
  );

for (const [op, message] of [
  [
    cluster.getClusterReplication({ id: "900-0" }),
    "no such replication job '900-0'\n",
  ],
  [cluster.putClusterReplication({ id: "900-0" }), "no such job '900-0'\n"],
  [cluster.deleteClusterReplication({ id: "900-0" }), "no such job '900-0'\n"],
] as const) {
  test(`replication ${message.trim()} is typed only on its vendor status`, async () => {
    expect(await call(op, 500, { data: null, message })).toMatchObject({
      _tag: "ReplicationJobNotFound",
    });
    expect(await call(op, 403, { data: null, message })).toMatchObject({
      _tag: "Forbidden",
    });
    for (const other of [
      undefined,
      "no such job 'unrelated'\n",
      message + "other failure",
      "got timeout\n",
    ]) {
      expect(await call(op, 500, { data: null, message: other })).toMatchObject(
        { _tag: "InternalServerError" },
      );
    }
  });
}

const missingAlias = {
  data: null,
  message: "Parameter verification failed.\n",
  errors: { name: "no such alias" },
};
for (const op of [
  cluster.getClusterFirewallAlias({ name: "test" }),
  cluster.putClusterFirewallAlias({ name: "test", cidr: "192.0.2.1" }),
]) {
  test("alias requires the sole exact errors.name detail", async () => {
    expect(await call(op, 400, missingAlias)).toMatchObject({
      _tag: "FirewallAliasNotFound",
    });
    expect(await call(op, 403, missingAlias)).toMatchObject({
      _tag: "Forbidden",
    });
    for (const errors of [
      { name: "no such alias", cidr: "invalid" },
      { other: "no such alias" },
      { name: "invalid alias" },
    ]) {
      expect(await call(op, 400, { ...missingAlias, errors })).toMatchObject({
        _tag: "ParameterVerificationFailed",
      });
    }
    expect(
      await call(op, 400, { ...missingAlias, message: "unrelated validation" }),
    ).toMatchObject({ _tag: "ParameterVerificationFailed" });
  });
}

test("absence patches do not classify unrelated operations", async () => {
  expect(
    await call(
      cluster.createClusterFirewallAlias({ name: "test", cidr: "192.0.2.1" }),
      400,
      missingAlias,
    ),
  ).toMatchObject({ _tag: "ParameterVerificationFailed" });
  expect(
    await call(
      cluster.deleteClusterFirewallAlias({ name: "test" }),
      400,
      missingAlias,
    ),
  ).toMatchObject({ _tag: "ParameterVerificationFailed" });
  expect(
    await call(
      cluster.createClusterReplication({
        id: "900-0",
        target: "pve-b",
        type: "local",
      }),
      500,
      { message: "no such job '900-0'\n" },
    ),
  ).toMatchObject({ _tag: "InternalServerError" });
});
