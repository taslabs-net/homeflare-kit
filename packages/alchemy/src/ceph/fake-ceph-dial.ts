/**
 * A fake `CephDial` for the tests beside it — no ssh, no spawned process, ever. The same idea as
 * `../linux/fake-sudo.ts` and `../openbao/fake-bao.ts`: production code is handed the real
 * implementation, a test hands this instead, and neither one's internals change to make room for
 * the other.
 *
 * ⛔ TEST-ONLY. Nothing in `src/` imports this outside a `.test.ts` file.
 */
import type { CephDial, CephExecResult } from './ceph-transport.ts';

/** One call this fake received. */
export type SeenCephCall = { readonly node: string; readonly argv: readonly string[] };

/** What a scripted node answers: a result, or a thrown transport failure. */
export type CephAnswer =
  | { readonly kind: 'result'; readonly result: CephExecResult }
  | { readonly kind: 'transport-error'; readonly message: string };

export type FakeCephDial = {
  readonly dial: CephDial;
  readonly seen: SeenCephCall[];
};

const ok = (stdout: string, exitCode = 0, stderr = ''): CephAnswer => ({
  kind: 'result',
  result: { exitCode, stderr, stdout },
});

/**
 * `script` maps a node to the fixed sequence of answers it gives, one per call that reaches it —
 * the last entry repeats once exhausted. A node with no entry always transport-fails, which is
 * exactly "an unreachable mon" without a special case.
 */
export const fakeCephDial = (
  script: Readonly<Record<string, readonly CephAnswer[]>>,
): FakeCephDial => {
  const seen: SeenCephCall[] = [];
  const counts = new Map<string, number>();
  const dial: CephDial = async (node, argv) => {
    seen.push({ argv, node });
    const answers = script[node];
    if (answers === undefined || answers.length === 0) {
      throw new Error(`fakeCephDial: ${node} is not reachable (no script entry)`);
    }
    const at = counts.get(node) ?? 0;
    counts.set(node, at + 1);
    const answer = answers[Math.min(at, answers.length - 1)];
    if (answer === undefined) throw new Error(`fakeCephDial: ${node} has no answer`);
    if (answer.kind === 'transport-error') throw new Error(answer.message);
    return answer.result;
  };
  return { dial, seen };
};

export { ok as fakeCephOk };
