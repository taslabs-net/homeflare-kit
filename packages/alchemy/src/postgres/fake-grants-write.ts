/**
 * The write-semantics half of the `Postgres.Grants` test fake, extracted from
 * `fake-grants-sql.ts` (the factory and the statement parser) to keep both files under the
 * cap: how one `GRANT`/`REVOKE` edits the in-memory ACL with the server's rule that a
 * superuser, the owner itself, or a member of the owning role performs the command AS the
 * owner (`select_best_grantor`, acl.c@REL_18_6; `revoke.sgml@REL_18_6`).
 *
 * ★ THE EFFECTIVE GRANTOR. `effectiveGrantor` names the role a write is recorded as: the
 *   owner when the executor acts as owner, otherwise the executor. A relation (table, column)
 *   is owned by its `relowner`; a schema by its `nspowner`; a default ACL has no owner, so the
 *   executor's own grants are the only ones its writes touch.
 * ★ `GRANT` records the words on the effective grantor's entry, upgrading a base word to its
 *   `*` (WITH GRANT OPTION) form rather than keeping both — one `aclitem` per pair.
 * ★ `REVOKE ALL` removes the effective grantor's entry only: a third grantor's grant to the
 *   same grantee SURVIVES silently (the survival `PostgresGrantsRepairRefused` surfaces), and
 *   a grantee that re-granted onward fails like the server without CASCADE (`2BP01`).
 */
import { SqlError, SqlSyntaxError } from 'effect/unstable/sql/SqlError';
import type { AclObject } from './fake-grants-parse.ts';
import { type FakeGrantsModel, revokesAsOwner } from './fake-grants-read.ts';

const sameObject = (a: AclObject, b: AclObject): boolean =>
  a.schema === b.schema &&
  a.table === b.table &&
  a.column === b.column &&
  a.defaultFor === b.defaultFor;

/** The role a `GRANT`/`REVOKE` from the executor on `object` is performed AS (see the header). */
export const effectiveGrantor = (model: FakeGrantsModel, object: AclObject): string => {
  if (object.table !== undefined) {
    const owner = model.tableOwners.get(`${object.schema}\u0000${object.table}`) ?? model.executor;
    return revokesAsOwner(model, owner) ? owner : model.executor;
  }
  if (object.defaultFor === undefined) {
    const owner = model.schemaOwners.get(object.schema) ?? model.executor;
    return revokesAsOwner(model, owner) ? owner : model.executor;
  }
  return model.executor;
};

/** Add words to the (object, grantee, effective-grantor) entry, upgrading a base word to its
 * `*` form rather than keeping both. */
export const grantWords = (
  model: FakeGrantsModel,
  object: AclObject,
  grantee: string,
  words: ReadonlyArray<string>,
  option: boolean,
): void => {
  const grantor = effectiveGrantor(model, object);
  const acl = model.acl;
  let entry = acl.find(
    (e) => sameObject(e.object, object) && e.grantee === grantee && e.grantor === grantor,
  );
  if (entry === undefined) {
    entry = { object, grantee, grantor, words: [] };
    acl.push(entry);
  }
  for (const word of words) {
    const base = word.replace(/\*$/, '');
    entry.words = entry.words.filter((w) => w.replace(/\*$/, '') !== base);
    entry.words.push(option ? `${word}*` : word);
  }
};

/** Remove the effective grantor's grants for (object, grantee); a third grantor's entry
 * survives by the keying, and a grantee that re-granted onward fails without CASCADE. */
export const revoke = (
  model: FakeGrantsModel,
  object: AclObject,
  grantee: string,
  operation: string,
): SqlError | undefined => {
  const grantor = effectiveGrantor(model, object);
  const acl = model.acl;
  const own = acl.filter(
    (e) => sameObject(e.object, object) && e.grantee === grantee && e.grantor === grantor,
  );
  if (own.length > 0 && acl.some((e) => sameObject(e.object, object) && e.grantor === grantee)) {
    return new SqlError({
      reason: new SqlSyntaxError({
        cause: Object.assign(new Error('dependent privileges exist'), { code: '2BP01' }),
        message: 'dependent privileges exist',
        operation,
      }),
    });
  }
  for (const entry of own) acl.splice(acl.indexOf(entry), 1);
  return undefined;
};
