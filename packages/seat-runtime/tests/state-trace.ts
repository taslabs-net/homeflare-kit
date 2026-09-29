/**
 * Two ways to look at what a state call put in a trace: in process (the spans themselves, with
 * their attributes) and on the wire (the OTLP protobuf a Victoria service would receive).
 *
 * ★ BOTH, BECAUSE THEY FAIL DIFFERENTLY. The in-process tracer proves what the layer SET; only the
 *   exported payload proves it survived the exporter, which is what the dashboards read.
 *   Attribute keys and string values travel as UTF-8 inside protobuf, so `contains` finds them.
 */
import { Effect, Layer, Tracer } from 'effect';
import * as ConfigProvider from 'effect/ConfigProvider';
import { SeatObs } from '../src/index.ts';
import type { Stub } from './stub.ts';

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Whether `needle` occurs in `haystack`. */
export function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  for (let at = 0; at + needle.length <= haystack.length; at++) {
    if (needle.every((byte, i) => haystack[at + i] === byte)) return true;
  }
  return false;
}

/** The spans a program made, as plain records, newest last. */
export type SeenSpan = {
  readonly name: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  /** `Success` or the exit tag the span ended with. */
  readonly ended: string;
};

/** Run `program` under a tracer that keeps every span; returns the result and the spans. */
export async function withSpans<A, E>(
  program: Effect.Effect<A, E, never>,
): Promise<{
  readonly exit: Awaited<ReturnType<typeof Effect.runPromiseExit<A, E>>>;
  readonly spans: SeenSpan[];
}> {
  const native: Tracer.NativeSpan[] = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      native.push(span);
      return span;
    },
  });
  const exit = await Effect.runPromiseExit(
    program.pipe(Effect.provideService(Tracer.Tracer, tracer)),
  );
  const spans = native.map((span) => ({
    name: span.name,
    attributes: Object.fromEntries(span.attributes),
    ended:
      span.status._tag === 'Ended'
        ? span.status.exit._tag === 'Success'
          ? 'Success'
          : 'Failure'
        : 'Started',
  }));
  return { exit, spans };
}

/**
 * Run `program` with the seat's OTLP layer pointed at `stub`, inside a `seat.state` span, and
 * return the trace payload the stub received once the scope closed and flushed.
 */
export async function traceExportedBy<A, E>(
  stub: Stub,
  program: Effect.Effect<A, E, never>,
): Promise<Uint8Array> {
  const obs = SeatObs.layer.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(stub.otlpEnv()))),
  );
  // ⚠️ The stub keeps every POST of the whole file: read only what THIS run sent.
  const path = '/insert/opentelemetry/v1/traces';
  const before = stub.at(path).length;
  await Effect.runPromise(
    Effect.scoped(program.pipe(Effect.withSpan('seat.state'), Effect.exit, Effect.provide(obs))),
  );
  return stub.at(path)[before]?.bytes ?? new Uint8Array();
}
