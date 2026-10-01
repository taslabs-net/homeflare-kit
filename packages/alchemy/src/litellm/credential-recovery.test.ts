/** A failed rewrite must describe the completed DELETE and recover on the next real deploy. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { type CredentialProps, LiteLLMCredential, credentialHandlers } from './credential.ts';
import { startFakeCredentialLitellm } from './fake-credential-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { FAKE_BASE } from './fake-litellm.ts';
import { FAKE_KEY, MASTER_KEY, failureOf, newFake, runAgainst, withEnv } from './key-harness.ts';

const variable = 'FAKE_RECOVERY_KEY';
const props: CredentialProps = {
  credentialName: 'recovery',
  credentialInfo: { note: 'search' },
  credentialValues: { api_key: { fromEnv: variable } },
};
const original = { ...props, credentialInfo: { ...props.credentialInfo, extra: 'remove' } };
const declare = (news: CredentialProps) =>
  Effect.gen(function* () {
    yield* LiteLLMCredential('Cred', news);
  });

for (const mode of ['transport', 'forbidden', 'validation'] as const) {
  test(`a rewrite POST ${mode} failure reports DELETE and the next deploy recreates`, async () => {
    const fake = startFakeCredentialLitellm({ masterKey: MASTER_KEY });
    let failPost = false;
    let postsFailed = 0;
    const fetch = (async (input, init) => {
      const request =
        input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      if (
        failPost &&
        request.method === 'POST' &&
        new URL(request.url).pathname === '/credentials'
      ) {
        postsFailed += 1;
        if (mode === 'transport') throw new TypeError('connection dropped');
        return new Response(JSON.stringify({ detail: 'replacement rejected' }), {
          status: mode === 'forbidden' ? 403 : 422,
          headers: { 'content-type': 'application/json' },
        });
      }
      return fake.fetch(request);
    }) as typeof globalThis.fetch;
    const engine = fakeStack({ apiKey: MASTER_KEY, baseUrl: FAKE_BASE }, fetch, 'Recovery', {
      noRetry: true,
    });
    await withEnv({ [variable]: FAKE_KEY }, async () => {
      await engine.deploy(declare(original));
      failPost = true;
      const message = await failureOf(engine.deploy(declare(props)));
      expect(message).toContain('DELETE already ran');
      expect(message).toContain('next deploy recreates');
      expect(message.includes(FAKE_KEY)).toBe(false);
      expect(postsFailed).toBe(1);
      expect(fake.rows()).toHaveLength(0);
      expect(writesOf(fake.requests())).toEqual([
        'POST /credentials',
        'DELETE /credentials/recovery',
      ]);
      failPost = false;
      await engine.deploy(declare(props));
      expect(fake.rows()).toHaveLength(1);
      expect(fake.rows()[0]?.credential_info).toEqual(props.credentialInfo);
      expect(await engine.deploy(declare(props))).toEqual({ Cred: 'noop' });
      expect(engine.snapshot().includes(FAKE_KEY)).toBe(false);

      // The same failure is catchable in the error channel, with no request or cause retained.
      await engine.deploy(declare(original));
      failPost = true;
      const error = await runAgainst(
        { ...newFake(), fetch },
        credentialHandlers
          .reconcile({
            fqn: 'Cred',
            instanceId: 'i-1',
            news: props,
            output: {
              credentialName: props.credentialName,
              credentialInfo: original.credentialInfo,
              valuesSeal: '',
            },
          })
          .pipe(
            Effect.catchTag('LitellmCredentialRewriteError', (failure) => Effect.succeed(failure)),
          ),
      );
      expect('_tag' in error && error._tag).toBe('LitellmCredentialRewriteError');
      expect(JSON.stringify(error).includes(FAKE_KEY)).toBe(false);
      expect('cause' in error).toBe(false);
      expect('request' in error).toBe(false);
    });
  });
}
