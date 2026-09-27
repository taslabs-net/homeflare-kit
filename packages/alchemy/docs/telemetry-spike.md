# Spike: what a stack's `providers` Layer captures (2026-09-26)

Offline, no live Victoria call, per the workflow's own rule. A throwaway script (deleted after this
was recorded — not committed; `layer.test.ts` and `http-client-sealing.test.ts` are what's kept) ran
`verify/fake-engine.ts`'s `engineOver` — the REAL `Alchemy.Stack` + `Plan.make` + `apply` over an
in-memory state store, alchemy `2.0.0-beta.79` — with:

- a fake OTLP collector (`fake-collector.ts`'s `Bun.serve`, capturing every POST's path/headers/body)
- `telemetryLayer({ endpoints: { traces: '<collector>/v1/traces' }, serviceName: 'spike' })` merged
  into the stack's `providers`
- one fake resource (`Spike.Thing`) whose `reconcile` wraps an `Effect.withSpan('spike.provider.
custom-span')` around an `HttpClient` `GET` to a SECOND fake server (`target`, standing in for
  whatever real endpoint a provider calls) at `<target>/probe?token=SECRET123` with an
  `authorization: Bearer sekrit` header
- a real `FetchHttpClient.layer` merged in as `ambient`, standing in for the platform layer a real
  `alchemy.run.ts`'s `Stack.ts` provides underneath the merged `providers` (admin-transport-
  scope.test.ts's own pattern) — `telemetryLayer`'s own `FetchHttpClient` is sealed, so without this
  the fake provider's `HttpClient.HttpClient` requirement has nothing to resolve to

## Question 1: which spans arrive when the tracer is provided via `providers`?

**All of them.** One `deploy()` (a create) produced exactly one POST to `/v1/traces` containing:

```
state_store.init, plan.diff.resource, plan.make,
http.client GET, spike.provider.custom-span,
provider.create, apply.resource, apply
```

- **The provider's own span** (`spike.provider.custom-span`) arrived.
- **The `HttpClient` client span** (`http.client GET`, effect's own `HttpClient.make` instrumentation)
  arrived — effect's tracing reads whatever `Tracer.Tracer` is ambient when the request runs, and
  the stack's `providers` context is exactly that.
- **Alchemy's own engine spans arrived too**: `plan.make` (Plan.ts), `apply`/`apply.resource`
  (Apply.ts's own `Effect.withSpan` calls), and `provider.create` — alchemy's OWN
  `instrumentLifecycle` wrapper (Apply.ts) puts every provider lifecycle call (`read`/`reconcile`/
  `delete`) in a `provider.${op}` span ALREADY, with `alchemy.resource.fqn`/`type`/`op` attributes —
  a provider doesn't need to add its own span just to get lifecycle-level tracing.
- `state_store.init` and `plan.diff.resource` are alchemy internals not named in the facts this
  workflow started from — recorded here since "measure which spans arrive" means all of them, not
  only the three anticipated.

**Why**: `verify/fake-engine.ts`'s `engineOver` builds `compiled.services` from the `providers`
layer, then runs `Plan.make`/`apply` with `Effect.provide(Layer.succeedContext(compiled.services))`
around them (`fake-engine.ts`'s `run`). Since `Tracer.Tracer` is an `effect/Tracer` `Context.
Reference` (a value with a process-wide default that any `Effect.provide` can override for the
effects it wraps), and `telemetryLayer` sets that reference via `Layer.effect(Tracer.Tracer, …)`
(the same shape `OtlpTracer.layer` itself uses), every span created inside that `Effect.provide` —
alchemy's own internals included — reads the OTLP-backed, redacting tracer, not effect's default.
**This holds specifically because the tracer is installed through the stack's OWN `providers`
option**, the mechanism `alchemy.run.ts` already exposes to every consumer stack — not through
alchemy's separate CLI-wide `Telemetry/Layer.ts` install this workflow's decision explicitly does
not touch.

## Question 2: does redaction hold on a REAL span, not just the unit tests?

Yes — the captured `http.client GET` span's `url.full` was `http://127.0.0.1:<port>/probe`: no
`?token=SECRET123`. With a `redaction: { denylist: [<target's host>, 'secret-site-abc123'] }` policy
and a target URL of `<target>/secret-site-abc123/probe?token=SECRET`, the captured attributes were:

```
server.address: "<redacted>"
url.full:       "http://<redacted>/<redacted>/probe"
url.path:       "/<redacted>/probe"
```

with **no `http.request.header.*` key at all** — the `authorization: Bearer sekrit` header was
dropped outright, not value-redacted. One correction this made to the implementation: effect's
`HttpClient.make` sets `server.address` to `url.origin` (`http://host:port`), not a bare hostname —
`redactAttribute`'s `server.address` branch now parses it with `URL` before comparing to the
denylist, rather than comparing the raw scheme-prefixed string (which would never match a
consumer's hostname-only denylist entry).

## Question 3: does the sealed transport actually seal?

Confirmed twice, once by accident: the FIRST version of this spike's script had no `ambient`
`FetchHttpClient` merged in, on the assumption that a leaking `telemetryLayer` would supply one. It
crashed instead — `error: Service not found: effect/HttpClient` — which is direct, if accidental,
proof that `telemetryLayer`'s own `FetchHttpClient` never reaches a sibling provider.
`http-client-sealing.test.ts`'s second test makes that assertion explicit and permanent
(`.rejects.toThrow()` with no `ambient` layer present) rather than relying on stumbling into it
again; its first test is the positive case (a sibling gets the real `ambient` client, not
telemetry's).

## Question 4: does the shutdown flush actually deliver a short CLI run's spans?

Yes, with no extra wait beyond `engine.deploy()`'s own returned `Promise` resolving. `OtlpExporter.
make` (effect's shared batch exporter) registers a `Scope.addFinalizer` that forces one more export
and awaits it (bounded by `shutdownTimeout`, default 3s) — and `engineOver`'s `run` wraps the whole
plan+apply effect in `Effect.scoped`, so that finalizer runs, and is awaited, before `deploy()`'s
promise settles. The spike's default `exportInterval` ('1 second') never even had to fire for the
one-resource run above; the shutdown flush alone delivered the batch. Confirmed separately: with
`endpoints: {}`, the fake collector saw zero requests even after waiting 1.5s (longer than the
default interval) past `deploy()` returning — nothing fires later on some other timer.
