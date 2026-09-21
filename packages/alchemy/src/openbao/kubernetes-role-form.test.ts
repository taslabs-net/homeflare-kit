/**
 * Bao.KubernetesRole's form: the selector the server resets is always sent, a read-back compares
 * equal, and the server's refusals are refused first. Placeholder names throughout.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type BaoKubernetesRoleProps,
  attributesOf,
  matches,
  problems,
  writeBody,
} from './kubernetes-role-form.ts';

const POD: BaoKubernetesRoleProps = {
  aliasNameSource: 'serviceaccount_name',
  boundServiceAccountNames: ['litellm'],
  boundServiceAccountNamespaces: ['ai'],
  name: 'ai-litellm',
  tokenPolicies: ['ai-litellm'],
  tokenTtl: '1h',
};

const LIVE: Record<string, unknown> = {
  alias_name_source: 'serviceaccount_name',
  bound_service_account_names: ['litellm'],
  bound_service_account_namespace_selector: '',
  bound_service_account_namespaces: ['ai'],
  token_bound_cidrs: [],
  token_explicit_max_ttl: 0,
  token_max_ttl: 0,
  token_no_default_policy: false,
  token_num_uses: 0,
  token_period: 0,
  token_policies: ['ai-litellm'],
  token_ttl: 3600,
  token_type: 'default',
};

const same = (live: Record<string, unknown>, props = POD) =>
  matches(attributesOf(props, live), props);

describe('kubernetes role form', () => {
  it('reads the stored role as the declared one; audience absent reads as none', () => {
    assert.equal(same(LIVE), true);
  });

  it('plans update when the alias source, names or audience drift', () => {
    assert.equal(same({ ...LIVE, alias_name_source: 'serviceaccount_uid' }), false);
    assert.equal(same({ ...LIVE, bound_service_account_names: ['*'] }), false);
    assert.equal(same({ ...LIVE, audience: 'vault' }), false);
  });

  it('always sends the selector and audience, so a stale one is cleared', () => {
    const body = writeBody(POD);
    assert.equal(body['bound_service_account_namespace_selector'], '');
    assert.equal(body['audience'], '');
    assert.equal(body['alias_name_source'], 'serviceaccount_name');
  });

  it("defaults the alias source to OpenBao's own, serviceaccount_uid", () => {
    const { aliasNameSource: _, ...rest } = POD;
    assert.equal(writeBody(rest)['alias_name_source'], 'serviceaccount_uid');
  });

  it('refuses empty names, a mixed `*`, no namespaces, and upper case', () => {
    assert.deepEqual(problems(POD), []);
    assert.match(problems({ ...POD, boundServiceAccountNames: [] }).join(), /is empty/);
    assert.match(problems({ ...POD, boundServiceAccountNames: ['*', 'x'] }).join(), /mixed/);
    assert.match(
      problems({ ...POD, boundServiceAccountNamespaces: [] }).join(),
      /no namespace selector/,
    );
    const selected = {
      ...POD,
      boundServiceAccountNamespaceSelector: '{"matchLabels":{"a":"b"}}',
      boundServiceAccountNamespaces: [],
    };
    assert.deepEqual(problems(selected), []);
    assert.match(problems({ ...POD, name: 'AI' }).join(), /lower case/);
  });
});
