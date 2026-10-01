import type { ReadableStreamDefaultReader } from 'node:stream/web';

export type GitResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

type CapturedProcess = Pick<
  Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
  'exited' | 'stdout' | 'stderr' | 'kill'
>;

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * ⛔ THE DEADLINE COVERS EXIT AND BOTH PIPES. Killing git does not guarantee `exited` resolves:
 * it may reject, or a transport child may keep a pipe open after git exits. Neither partial
 * output nor exit 0 alone is an answer we may use to exclude commits from the secret scan.
 * ★ Own the readers so failure cancels pending reads. Cleanup is best effort and never awaited:
 * a stuck cancellation or exit promise must not defeat the deadline and hang pre-push again.
 */
export async function gitOutput(proc: CapturedProcess, timeoutMs?: number): Promise<GitResult> {
  const stdoutReader = proc.stdout.getReader();
  const stderrReader = proc.stderr.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const completed = Promise.all([
      proc.exited,
      readText(stdoutReader),
      readText(stderrReader),
    ]).then(([code, stdout, stderr]) => ({ code, stdout, stderr }));
    if (timeoutMs === undefined) return await completed;
    return await Promise.race([
      completed,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('git timed out')), timeoutMs);
      }),
    ]);
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      // An already-exited process needs no signal; its pipes still need cancellation.
    }
    for (const reader of [stdoutReader, stderrReader]) void reader.cancel().catch(() => {});
    return { code: -1, stdout: '', stderr: '' };
  } finally {
    clearTimeout(timer);
  }
}
