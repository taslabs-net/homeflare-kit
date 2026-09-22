/**
 * The pure half of MeshNode: which edits are an update and which a replace — and in which order.
 *
 * ★ The replace ORDER is the part worth testing. Names are unique per account, so an `ha` change
 *   that keeps the name must delete first; one that also renames must not, or it would take the
 *   node offline for no reason.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { type MeshNodeAttributes, diffMeshNode, validateMeshNode } from './mesh-node-form.ts';

const ACCOUNT = '00000000000000000000000000000001';
const output: MeshNodeAttributes = {
  id: '00000000-0000-4000-8000-000000000001',
  accountId: ACCOUNT,
  name: 'door-a',
  status: 'healthy',
  ha: false,
};

describe('diffMeshNode', () => {
  test('no prior output: no opinion, the engine creates', () => {
    expect(diffMeshNode({ name: 'door-a', ha: false }, undefined, ACCOUNT)).toBeUndefined();
  });

  test('nothing changed: no opinion', () => {
    expect(diffMeshNode({ name: 'door-a', ha: false }, output, ACCOUNT)).toBeUndefined();
  });

  test('a rename alone is an in-place update (PATCH keeps id, token and Mesh IPs)', () => {
    expect(diffMeshNode({ name: 'door-b', ha: false }, output, ACCOUNT)).toEqual({
      action: 'update',
    });
  });

  test('ha changed under the same name: replace, delete first (names are unique)', () => {
    expect(diffMeshNode({ name: 'door-a', ha: true }, output, ACCOUNT)).toEqual({
      action: 'replace',
      deleteFirst: true,
    });
  });

  test('ha changed with a new name: replace, create first (nothing collides)', () => {
    expect(diffMeshNode({ name: 'door-b', ha: true }, output, ACCOUNT)).toEqual({
      action: 'replace',
    });
  });

  test('ha changed while the name is unresolved: the order that cannot collide', () => {
    const news = { name: Effect.succeed('door-a'), ha: true } as never;
    expect(diffMeshNode(news, output, ACCOUNT)).toEqual({ action: 'replace', deleteFirst: true });
  });

  test('an unresolved ha gives no answer; reconcile re-checks it', () => {
    const news = { name: 'door-a', ha: Effect.succeed(true) } as never;
    expect(diffMeshNode(news, output, ACCOUNT)).toBeUndefined();
  });

  test('another account is a create-first replace', () => {
    const other = '00000000000000000000000000000002';
    expect(diffMeshNode({ name: 'door-a', ha: false }, output, other)).toEqual({
      action: 'replace',
    });
  });
});

describe('validateMeshNode', () => {
  test('accepts a plain declaration', () => {
    expect(validateMeshNode({ name: 'door-a', ha: true })).toBeUndefined();
  });

  test('refuses an empty or padded name, because adoption matches exactly', () => {
    expect(validateMeshNode({ name: '  ', ha: false })?.message).toContain('non-empty');
    expect(validateMeshNode({ name: ' door-a', ha: false })?.message).toContain('whitespace');
  });

  test('refuses a missing ha: it is create-only, so there is no default', () => {
    expect(validateMeshNode({ name: 'door-a' } as never)?.message).toContain('no default');
  });
});
