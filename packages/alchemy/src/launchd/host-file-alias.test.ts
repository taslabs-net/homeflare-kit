/**
 * Host.File's diff while `content` is still an Output, over the REAL localRunner in a fresh temp
 * directory: a new path is a replace, unless it is the old file under another spelling
 * (file-identity.ts), where a replace's Phase 2 would delete the file the new generation took.
 *
 * 🔴 The respelled case answered `replace` before the fix (2026-09-22). Nothing outside `mkdtemp`
 *   is touched; the diff only reads.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { HostFile, HostFileProvider } from './host-file.ts';
import { localRunner } from './local-runner.ts';
import { hostRunnerLayer } from './runner.ts';

let tmp = '';
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hf-file-alias-'));
  await mkdir(join(tmp, 'real'));
  await writeFile(join(tmp, 'real', 'a.conf'), 'x');
  await symlink(join(tmp, 'real'), join(tmp, 'link'));
});
afterEach(async () => {
  await rm(tmp, { force: true, recursive: true });
});

const diffTo = (path: string) => {
  const output = {
    gid: 0,
    mode: 0o644,
    path: join(tmp, 'real', 'a.conf'),
    sha256: '',
    size: 1,
    uid: 0,
  };
  const news = { content: Effect.succeed('x'), path } as never;
  return Effect.runPromise(
    Effect.gen(function* () {
      const diff = (yield* HostFile.Provider).diff;
      if (diff === undefined) throw new Error('Host.File has no diff');
      return yield* diff({
        bindings: [] as never,
        fqn: 'stack/conf',
        id: 'conf',
        instanceId: 'i-1',
        newBindings: [] as never,
        news,
        oldBindings: [] as never,
        olds: { content: 'x', path: output.path },
        output,
      } as never);
    }).pipe(Effect.provide(HostFileProvider().pipe(Layer.provide(hostRunnerLayer(localRunner()))))),
  );
};

test('another file is still a replace', async () => {
  expect(await diffTo(join(tmp, 'real', 'b.conf'))).toEqual({ action: 'replace' });
});

test('⛔ the same file through a symlinked parent is left to the engine (an update)', async () => {
  expect(await diffTo(join(tmp, 'link', 'a.conf'))).toBeUndefined();
});
