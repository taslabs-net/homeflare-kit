/**
 * Pool family — compile-time and runtime checks against generated `/pools` schema types.
 *
 * ⚠️ THE DRIFT TEST IS THE POINT: if codegen renames a parameter or marks `poolid` optional on
 *   POST, this file fails `tsc` before anything reaches a cluster.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolsPoolidPutParams, PoolsPostParams } from './generated/pve.ts';
import { type PoolProps, poolCreateForm, poolUpdateForm } from './pool.ts';

const target: PoolProps['target'] = {
  members: ['example.test'],
  mount: 'proxmox-test',
  scheme: 'pve',
};

const props = (over: Partial<PoolProps> = {}): PoolProps => ({
  target,
  poolid: 'lab',
  ...over,
});

describe('pool forms match generated POST/PUT parameters', () => {
  it('createForm sends exactly poolid and comment', () => {
    const form: PoolsPostParams = poolCreateForm(props({ comment: 'estate' }));
    assert.deepEqual(form, { poolid: 'lab', comment: 'estate' });
    assert.deepEqual(Object.keys(form).sort(), ['comment', 'poolid']);
  });

  it('updateForm sends only comment on the deprecated item path', () => {
    const form: Pick<PoolsPoolidPutParams, 'comment'> = poolUpdateForm(props());
    assert.deepEqual(form, { comment: '' });
    assert.deepEqual(Object.keys(form), ['comment']);
  });

  it('would fail tsc if poolid were dropped from createForm', () => {
    // @ts-expect-error poolid is required on POST /pools
    const bad: PoolsPostParams = { comment: '' };
    assert.equal('poolid' in bad, false);
  });
});
