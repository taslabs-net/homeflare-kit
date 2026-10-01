import { expect, spyOn, test } from 'bun:test';
import { knownRemoteTips } from '../src/hooks/push-remote.ts';

test('a rewritten destination is never contacted for refs', async () => {
  const spawn = spyOn(Bun, 'spawn').mockImplementation((...args) => {
    expect(args[0]).toEqual([
      'git',
      '-C',
      '/unused-root',
      'ls-remote',
      '--get-url',
      'file:///push',
    ]);
    return {
      exited: Promise.resolve(0),
      stdout: new Response('file:///fetch\n').body,
      stderr: new Response('').body,
    } as unknown as ReturnType<typeof Bun.spawn>;
  });
  try {
    expect(await knownRemoteTips('/unused-root', 'file:///push')).toEqual({
      tips: [],
      via: undefined,
      rewritten: true,
    });
    expect(spawn).toHaveBeenCalledTimes(1);
  } finally {
    spawn.mockRestore();
  }
});

/**
 * ⚠️ A killed process can reject `exited`, or leave a pipe open (a descendant inherited it).
 * A successful exit with partial advertised tips is equally unsafe until BOTH pipes finish.
 * Mock the process boundary, keeping the real deadline logic but shortening its 20s delay.
 */
for (const failure of ['rejected exit', 'pending exit', 'stdout', 'stderr'] as const) {
  test(`${failure} discards partial tips and returns the full-history fallback within a bound`, async () => {
    const url = 'file:///unused-destination';
    const nativeTimeout = globalThis.setTimeout;
    const timer = spyOn(globalThis, 'setTimeout').mockImplementation(
      Object.assign(
        (...[fn, ms, ...args]: Parameters<typeof setTimeout>) =>
          nativeTimeout(fn, ms === 20_000 ? 25 : ms, ...args),
        nativeTimeout,
      ),
    );
    let killed = false;
    let cancelled = 0;
    function pipe(text: string, hung: boolean): ReadableStream<Uint8Array> {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          if (!hung) controller.close();
        },
        cancel() {
          cancelled++;
          // Cleanup itself must not hold the full-history fallback hostage.
          return new Promise(() => {});
        },
      });
    }
    const spawn = spyOn(Bun, 'spawn').mockImplementation((...args) => {
      const command = args[0] as string[];
      const expansion = command.includes('--get-url');
      return {
        exited: expansion
          ? Promise.resolve(0)
          : failure === 'rejected exit'
            ? Promise.reject(new Error('killed'))
            : failure === 'pending exit'
              ? new Promise(() => {})
              : Promise.resolve(0),
        stdout: pipe(
          expansion ? `${url}\n` : `${'a'.repeat(40)}\trefs/heads/main\n`,
          !expansion && failure === 'stdout',
        ),
        stderr: pipe('', !expansion && failure === 'stderr'),
        kill() {
          killed = true;
        },
      } as unknown as ReturnType<typeof Bun.spawn>;
    });
    let bound: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        knownRemoteTips('/unused-root', url),
        new Promise<never>((_, reject) => {
          bound = nativeTimeout(() => reject(new Error('fallback hung')), 250);
        }),
      ]);
      expect(result).toEqual({ tips: [], via: undefined });
      expect(killed).toBe(true);
      if (failure === 'stdout' || failure === 'stderr') expect(cancelled).toBe(1);
    } finally {
      clearTimeout(bound);
      spawn.mockRestore();
      timer.mockRestore();
    }
  });
}
