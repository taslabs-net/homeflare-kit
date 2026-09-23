/**
 * (ii) The write-recording fake, happy paths: a create sends the extension flag and
 * `allowedMergeMethods`; a matching live ruleset makes zero writes (S10); one drifted field
 * makes exactly one `update`, never a create. Refusals (zero writes) and the readback check
 * are repository-ruleset-write-refusals.test.ts, split out to stay under the 250-line cap.
 */
import { describe, expect, test } from 'bun:test';
import { makeRecordingFake } from './repository-ruleset-fake-octokit.ts';
import { desiredWireRuleset } from './repository-ruleset-form.ts';
import { props, reconcileAgainst, run } from './repository-ruleset-test-helpers.ts';

describe('create', () => {
  test('sends allowedMergeMethods and the extension flag, and nothing else creates', async () => {
    const fake = makeRecordingFake({});
    fake.reportedContexts.add('ci');
    const attrs = await run(reconcileAgainst(fake, props()));
    expect(fake.writes).toHaveLength(1);
    const [write] = fake.writes;
    expect(write?.op).toBe('create');
    expect(write?.repo).toBe('widgets');
    const pr = write?.body?.rules?.find((r) => r.type === 'pull_request');
    expect(
      (pr as { parameters: Record<string, unknown> }).parameters.allowed_merge_methods,
    ).toEqual(['squash']);
    expect(
      (pr as { parameters: Record<string, unknown> }).parameters
        .require_extra_approval_for_unattributed_changes,
    ).toBe(false);
    expect(attrs.name).toBe('main');
  });
});

describe('noop and update', () => {
  test('a matching live ruleset makes zero writes', async () => {
    const desired = desiredWireRuleset(props());
    const fake = makeRecordingFake({
      widgets: {
        id: 1,
        name: desired.name,
        target: desired.target,
        source_type: 'Repository',
        enforcement: desired.enforcement,
        bypass_actors: desired.bypass_actors as never,
        conditions: desired.conditions,
        rules: desired.rules as never,
      },
    });
    fake.reportedContexts.add('ci');
    await run(reconcileAgainst(fake, props(), { rulesetId: 1 }));
    expect(fake.writes).toHaveLength(0);
  });

  test('one drifted field makes exactly one update, never a create', async () => {
    const desired = desiredWireRuleset(props());
    const fake = makeRecordingFake({
      widgets: {
        id: 1,
        name: desired.name,
        target: desired.target,
        source_type: 'Repository',
        enforcement: desired.enforcement,
        bypass_actors: desired.bypass_actors as never,
        conditions: desired.conditions,
        rules: (desired.rules ?? []).map((r) =>
          r.type === 'pull_request'
            ? {
                ...r,
                parameters: {
                  ...r.parameters,
                  allowed_merge_methods: ['merge', 'squash', 'rebase'],
                },
              }
            : r,
        ) as never,
      },
    });
    fake.reportedContexts.add('ci');
    await run(reconcileAgainst(fake, props(), { rulesetId: 1 }));
    expect(fake.writes).toHaveLength(1);
    const [write] = fake.writes;
    expect(write?.op).toBe('update');
  });
});
