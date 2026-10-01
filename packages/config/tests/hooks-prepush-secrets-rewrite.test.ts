/**
 * 🔴 A fetch-direction insteadOf can redirect even the URL handed to pre-push. The fetch
 * repo already holds our FAKE secret; trusting its tips would exclude the entire finding.
 * Tokens exist only at runtime, and every local repository is removed even on assertion failure.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { realPush, removeBins } from './hooks-harness.ts';
import {
  ZERO,
  bareRemote,
  cleanFixtures,
  commit,
  fixture,
  realEnv,
  remoteRef,
  runtimeToken,
  sha,
} from './hooks-secrets-fixture.ts';

afterAll(async () => {
  await cleanFixtures();
  await removeBins();
});

describe.skipIf(Bun.which('gitleaks') === null)('fetch rewriting of the hook URL', () => {
  for (const pushInsteadOf of [false, true]) {
    test(`finds the secret despite insteadOf (pushInsteadOf=${String(pushInsteadOf)})`, async () => {
      try {
        const { repo, remote } = await fixture();
        const destinationRepo = await bareRemote();
        const destination = `file://${destinationRepo}`;
        await repo.git('push', '--quiet', destination, 'main');
        const secret = await commit(repo, 'config.txt', `token = ${runtimeToken()}\n`);
        await repo.git('push', '--quiet', 'origin', 'HEAD:refs/heads/feat');
        await repo.git('config', `url.file://${remote}.insteadOf`, destination);
        if (pushInsteadOf) {
          await repo.git('config', `url.${destination}.pushInsteadOf`, 'hf-push://target');
        }
        // Demonstrate the dangerous answer before running the guard: the other repo has HEAD.
        expect(await repo.git('ls-remote', '--get-url', destination)).toBe(`file://${remote}\n`);
        expect(await repo.git('ls-remote', destination)).toContain(await sha(repo));

        const result = pushInsteadOf
          ? await realPush(repo, realEnv(), 'hf-push://target', 'feat')
          : await repo.hook('pre-push', {
              env: realEnv(),
              args: ['origin', destination],
              stdin: `refs/heads/feat ${secret} refs/heads/feat ${ZERO}\n`,
            });

        expect(result.code).not.toBe(0);
        expect(result.output).toContain('gitleaks found a secret in the commits being pushed');
        expect(result.output).toContain('destination URL is rewritten by insteadOf');
        expect(result.output).toContain('so it was not asked');
        expect(result.output).toContain('full pushed history was scanned');
        expect(result.output).not.toContain('already on the remote');
        expect(result.output).not.toMatch(/ghp_[0-9A-Za-z]{36}/);
        expect(await remoteRef(destinationRepo, 'feat')).toBeUndefined();
      } finally {
        await cleanFixtures();
      }
    });
  }
});
