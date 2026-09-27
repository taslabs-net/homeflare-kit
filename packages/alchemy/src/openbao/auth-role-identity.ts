import { readPath } from './auth-role-form.ts';
import { authRoleExists } from './auth-role-wire.ts';
import { declaredString, judgeMoveWith } from './rename.ts';
import { foldName, nameIdentity } from './rename-identity.ts';

export const authRoleIdentity = nameIdentity<{ readonly name: string }>(
  'Bao.AuthRole',
  readPath,
  foldName,
);

/** All occupied-name reads share the SDK's typed absence and refusal behavior. */
export const judgeAuthRoleRename = (
  olds: unknown,
  news: unknown,
  output: { readonly name: string } | undefined,
) =>
  judgeMoveWith(
    'Bao.AuthRole',
    output === undefined ? declaredString(olds, 'name') : output.name,
    declaredString(news, 'name'),
    authRoleExists,
    foldName,
  );
