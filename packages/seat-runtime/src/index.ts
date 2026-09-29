/**
 * @homeflare/seat-runtime — the model and telemetry layers every HomeFlare coding seat shares.
 *
 * ⛔ RUNTIME-NEUTRAL: nothing here imports `bun:*` or `node:*`. It rides `fetch`, so it runs
 *   under Bun, Node and workerd alike.
 */
export * as SeatModel from './seat-model.ts';
export * as SeatObs from './seat-obs.ts';
export { VERSION } from './version.ts';
