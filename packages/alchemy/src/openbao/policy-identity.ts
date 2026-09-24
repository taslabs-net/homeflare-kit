import { policyExists, policyPath } from './policy-wire.ts';
import { declaredString, judgeMoveWith, policyKey } from './rename.ts';
import { nameIdentity } from './rename-identity.ts';

/** A policy is its name, keyed as OpenBao keys it (`policyKey`). */
export const policyIdentity = nameIdentity<{ readonly name: string }>(
  'Bao.Policy',
  policyPath,
  policyKey,
);

/** The occupied-name guard must use the same SDK and refusal semantics as every other read. */
export const judgePolicyRename = (
  olds: unknown,
  news: unknown,
  output: { readonly name: string } | undefined,
) =>
  judgeMoveWith(
    'Bao.Policy',
    output === undefined ? declaredString(olds, 'name') : output.name,
    declaredString(news, 'name'),
    policyExists,
    policyKey,
  );
