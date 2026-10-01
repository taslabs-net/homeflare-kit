/**
 * The `Postgres.Role` password: resolution from the environment and the seal arithmetic that
 * lets state answer "did this value already go out?" without storing it (S25).
 *
 * ⛔ THE PASSWORD IS A REFERENCE, NEVER A VALUE. It is declared as
 *   `{ fromEnv: 'PG_SEAT_WIDGET_PASSWORD' }`; the NAME lands in state, the value is resolved
 *   from the deploying process's environment at reconcile/diff time, held as `Redacted`, and
 *   quoted into the one `ALTER ROLE … PASSWORD` statement that needs it.
 * ★ What state remembers is a `scrypt:<salt>:<digest>` seal ({@link sealPassword}), so a
 *   reconcile sends the password only when the environment value differs from the one last
 *   written — a plan never re-sends a secret that already matches, and never stores one.
 */
import * as Redacted from 'effect/Redacted';
import { type Environment, resolveAll, seal, sealMatches } from '../secrets/write-only.ts';
import type { PostgresRoleProps } from './role-attrs.ts';

/** What the environment holds for the declared password. `value` is `undefined` when no
 * password is declared, or when the variable is unset or empty (a renderer that failed writes
 * `NAME=`; `resolveAll` treats empty as missing). ⛔ Reads the environment at CALL time. */
export interface ResolvedPassword {
  readonly variable: string | undefined;
  readonly value: Redacted.Redacted<string> | undefined;
}

export const resolvePassword = (
  props: PostgresRoleProps,
  env: Environment = process.env,
): ResolvedPassword => {
  if (props.password === undefined) return { variable: undefined, value: undefined };
  const { values } = resolveAll({ password: props.password }, env);
  const raw = values['password'];
  return {
    variable: props.password.fromEnv,
    value: raw === undefined ? undefined : Redacted.make(raw),
  };
};

/** `seal({ password })` of the resolved value — the one thing state remembers about it. */
export const sealPassword = (value: Redacted.Redacted<string>): string =>
  seal({ password: Redacted.value(value) });

/** Whether the seal was made from the resolved value. Malformed/empty seals answer false, so an
 * adopted role (seal `''`) or one written outside this stack gets the password written on the
 * first reconcile that holds the variable — the declaration is authoritative. */
export const passwordMatchesSeal = (value: Redacted.Redacted<string>, sealed: string): boolean =>
  sealMatches(sealed, { password: Redacted.value(value) });
