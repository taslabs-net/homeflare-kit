import type { PveTarget } from './credentials.ts';

/** A lifecycle refusal. Post-write refusals carry the task diagnostic, never imply rollback. */
export class LxcRefusedError extends Error {
  override readonly name = 'LxcRefusedError';
}

/** Where one guest lives. Its identity, and nothing else. */
export type LxcWhere = { readonly target: PveTarget; readonly node: string; readonly vmid: number };
