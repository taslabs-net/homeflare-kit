/**
 * (iii) MEASURES, against a real `@octokit/rest` instance with a fetch shim (no network), the
 * one open question H15 depends on: does Octokit's own request builder forward
 * `require_extra_approval_for_unattributed_changes` — a field its own TypeScript types do not
 * declare — onto the wire, or silently strip it the way `@distilled.cloud/github`'s `S.Struct`
 * request schemas are reasoned (not measured) to? This is a MEASUREMENT, not an assertion about
 * intent: if this test ever starts failing, H15's premise no longer holds and the client choice
 * in repository-ruleset.ts needs revisiting, not a quiet update to make the test pass again.
 */
import { describe, expect, test } from 'bun:test';
import { Octokit } from '@octokit/rest';
import { desiredWireRuleset } from './repository-ruleset-form.ts';

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function makeCapturingFetch(captured: CapturedRequest[]): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    captured.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify({ id: 1, name: 'main', rules: [] }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('does Octokit forward an untyped extra body field to the wire?', () => {
  // K1 (2026-09-23): both values are modeled now, not only `false` — 8 live rulesets (aop,
  // cloudflareforms, doesthishelp-workeropen, homeflare-anyauth, homeflare-desktop, loggarr,
  // magictransit, proxmox-tb4; re-read live 2026-09-23) carry `true`, so this measurement needs
  // both, not just the one value this resource used to be able to send.
  test.each([false, true])(
    'require_extra_approval_for_unattributed_changes: %p survives createRepoRuleset',
    async (value) => {
      const captured: CapturedRequest[] = [];
      const octokit = new Octokit({
        auth: 'fake-token-not-a-real-credential',
        request: { fetch: makeCapturingFetch(captured) },
      });

      const body = desiredWireRuleset({
        owner: 'taslabs-net',
        repository: 'widgets',
        name: 'main',
        rules: {
          pullRequest: {
            requiredApprovingReviewCount: 0,
            allowedMergeMethods: ['squash'],
            extraApprovalForUnattributedChanges: value,
          },
        },
      });

      await octokit.rest.repos.createRepoRuleset({
        owner: 'taslabs-net',
        repo: 'widgets',
        ...body,
      });

      expect(captured).toHaveLength(1);
      const sent = captured[0]?.body as {
        rules?: { type: string; parameters?: Record<string, unknown> }[];
      };
      const pr = sent?.rules?.find((r) => r.type === 'pull_request');
      // MEASURED: this is what actually crossed the wire, not what Octokit's types say is legal.
      expect(pr?.parameters?.require_extra_approval_for_unattributed_changes).toBe(value);
      expect(pr?.parameters?.allowed_merge_methods).toEqual(['squash']);
    },
  );
});
