/**
 * `LiteLLM.PolicyAttachment` through Alchemy's real Plan and Apply over the fake proxy
 * (`fake-policy-attachment-litellm.ts`): create, no-op, adopt by content, the create-first replace,
 * removal, and the refusals.
 *
 * ★ EVERY VALUE IS `FAKE-*`.
 * ⚠️ WHAT THE FAKE MODELS IS READ FROM THE 1.103.0 SOURCE, NOT MEASURED ON A LIVE PROXY (its header).
 */
import { expect, test } from 'bun:test';
import { credentials } from '@distilled.cloud/litellm/Credentials';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { FAKE_BASE } from './fake-litellm.ts';
import {
  type FakePolicyAttachmentLitellm,
  attachmentRow,
  startFakePolicyAttachmentLitellm,
} from './fake-policy-attachment-litellm.ts';
import { FAKE_KEY } from './fake-registry-base.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMPolicyAttachment } from './policy-attachment.ts';
import { deleteAttachment } from './policy-attachment-operations.ts';
import type { PolicyAttachmentProps } from './policy-attachment-types.ts';

const stack = (fake: FakePolicyAttachmentLitellm) =>
  fakeStack({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: PolicyAttachmentProps, name = 'Attach') =>
  Effect.gen(function* () {
    yield* LiteLLMPolicyAttachment(name, props);
  });

const options = { knownTeams: ['fake-team'], policies: ['FAKE-baseline'] };
const global: PolicyAttachmentProps = { policyName: 'FAKE-baseline', scope: '*' };
const scoped: PolicyAttachmentProps = {
  models: ['fake-code', 'fake-flash'],
  policyName: 'FAKE-baseline',
  priority: 10,
  teams: ['fake-team'],
};

test('creates a global attachment, then a second deploy writes nothing', async () => {
  const fake = startFakePolicyAttachmentLitellm(options);
  const same = stack(fake);
  expect(await same.deploy(declare(global))).toEqual({ Attach: 'create' });
  expect(fake.attachments()[0]).toMatchObject({
    policy_name: 'FAKE-baseline',
    scope: '*',
    teams: [],
  });
  const before = fake.requests().length;
  expect(await same.deploy(declare(global))).toEqual({ Attach: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('sends every declared selector and the priority, and only those', async () => {
  const fake = startFakePolicyAttachmentLitellm(options);
  await stack(fake).deploy(declare(scoped));
  expect(fake.bodies()[0]).toEqual({
    models: ['fake-code', 'fake-flash'],
    policy_name: 'FAKE-baseline',
    priority: 10,
    teams: ['fake-team'],
  });
});

test('a change is a create-first REPLACE and the old attachment is deleted afterwards', async () => {
  const fake = startFakePolicyAttachmentLitellm(options);
  const same = stack(fake);
  await same.deploy(declare(scoped));
  const before = fake.requests().length;
  expect(await same.deploy(declare({ ...scoped, models: ['fake-code'] }))).toEqual({
    Attach: 'replace',
  });
  // ★ create first, delete second: for a moment both applied, and none of that window was unattached
  expect(writesOf(fake.requests().slice(before))).toEqual([
    'POST /policies/attachments',
    'DELETE /policies/attachments/FAKE-attachment-0001',
  ]);
  expect(fake.attachments()).toHaveLength(1);
  expect(fake.attachments()[0]).toMatchObject({
    attachment_id: 'FAKE-attachment-0002',
    models: ['fake-code'],
  });
});

test('removing the declaration DELETES the attachment: it holds no data, and a retained one would keep the scope attached', async () => {
  const fake = startFakePolicyAttachmentLitellm(options);
  const same = stack(fake);
  await same.deploy(declare(scoped));
  await same.deploy(Effect.void);
  expect(fake.attachments()).toEqual([]);
});

test('a live attachment is adopted by CONTENT: Unowned without --adopt, adopted with it, and a match writes nothing', async () => {
  const live = attachmentRow({
    attachment_id: 'FAKE-live-1',
    models: ['fake-flash', 'fake-code'],
    policy_name: 'FAKE-baseline',
    priority: 10,
    teams: ['fake-team'],
  });
  const fake = startFakePolicyAttachmentLitellm({ ...options, seed: [live] });
  const engine = stack(fake);
  await expect(engine.deploy(declare(scoped))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
  expect(Object.values(await engine.deploy(declare(scoped), { adopt: true }))).toEqual(['adopted']);
  expect(writesOf(fake.requests())).toEqual([]);
});

test('two identical live attachments are refused, never guessed at', async () => {
  const twin = (id: string) =>
    attachmentRow({ attachment_id: id, policy_name: 'FAKE-baseline', scope: '*' });
  const fake = startFakePolicyAttachmentLitellm({
    ...options,
    seed: [twin('FAKE-live-a'), twin('FAKE-live-b')],
  });
  await expect(stack(fake).deploy(declare(global), { adopt: true })).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
});

test('a config-file attachment is never adopted: an equal one is ignored and a database one is created', async () => {
  const fake = startFakePolicyAttachmentLitellm({
    ...options,
    configAttachments: [{ policy_name: 'FAKE-baseline', scope: '*' }],
  });
  expect(await stack(fake).deploy(declare(global))).toEqual({ Attach: 'create' });
  expect(fake.attachments()).toHaveLength(1);
});

test('an attachment with no selector is refused before any request: LiteLLM would make it GLOBAL', async () => {
  const fake = startFakePolicyAttachmentLitellm(options);
  await expect(stack(fake).deploy(declare({ policyName: 'FAKE-baseline' }))).rejects.toThrow();
  expect(fake.requests()).toEqual([]);
});

test('other refused declarations fail the plan before a single request', async () => {
  for (const props of [
    { ...scoped, policyName: ' ' },
    { ...scoped, scope: 'FAKE' as never },
    { ...scoped, teams: ['fake-team', 'fake-team'] },
    { ...scoped, models: [''] },
    { ...scoped, priority: 1.5 },
    { ...scoped, priority: 2147483648 },
  ]) {
    const fake = startFakePolicyAttachmentLitellm(options);
    await expect(stack(fake).deploy(declare(props))).rejects.toThrow();
    expect(fake.requests()).toEqual([]);
  }
});

test('a team that does not exist yet fails the create (declare the alias from the Team), a wildcard is let through', async () => {
  const fake = startFakePolicyAttachmentLitellm(options);
  await expect(
    stack(fake).deploy(declare({ ...scoped, teams: ['fake-missing'] })),
  ).rejects.toThrow();
  expect(fake.attachments()).toEqual([]);
  await stack(fake).deploy(declare({ ...scoped, teams: ['fake-*'] }, 'Wild'));
  expect(fake.attachments()).toHaveLength(1);
});

test('a policy with no production version fails the create and leaves nothing behind', async () => {
  const fake = startFakePolicyAttachmentLitellm({ knownTeams: [], policies: [] });
  await expect(stack(fake).deploy(declare(global))).rejects.toThrow();
  expect(fake.attachments()).toEqual([]);
});

const run = <A, E>(fetchFn: typeof globalThis.fetch, effect: Effect.Effect<A, E, unknown>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)),
      Effect.provide(credentials({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE })),
    ) as Effect.Effect<A, E, never>,
  );

test('delete of a missing id is swallowed only because the list says it is gone', async () => {
  const live = attachmentRow({
    attachment_id: 'FAKE-live-2',
    policy_name: 'FAKE-baseline',
    scope: '*',
  });
  const fake = startFakePolicyAttachmentLitellm({ ...options, seed: [live] });
  await run(fake.fetch, deleteAttachment('FAKE-live-2'));
  expect(fake.attachments()).toEqual([]);
  await run(fake.fetch, deleteAttachment('FAKE-live-2'));
});

test('a delete refused for lack of rights re-raises the ORIGINAL error and the row stays', async () => {
  const live = attachmentRow({
    attachment_id: 'FAKE-live-3',
    policy_name: 'FAKE-baseline',
    scope: '*',
  });
  const fake = startFakePolicyAttachmentLitellm({ ...options, forbidDelete: true, seed: [live] });
  await expect(run(fake.fetch, deleteAttachment('FAKE-live-3'))).rejects.toThrow();
  expect(fake.attachments()).toHaveLength(1);
});
