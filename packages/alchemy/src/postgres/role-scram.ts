/**
 * SCRAM-SHA-256 password verifier, built client-side the way `psql \password` and `createuser -w`
 * do (`createuser.c@REL_18_6` → `pg_format scram verifier`). Postgres stores the verifier as-is in
 * `pg_authid.rolpassword` and never recovers the password from it.
 *
 * ⛔ THE PLAIN PASSWORD NEVER ENTERS A STATEMENT. Before this file, `ALTER ROLE … PASSWORD` carried
 *   the plain value as a literal, so it landed in the Effect SQL span attribute `db.query.text`,
 *   in `pg_stat_statements` (`track_utility=on` records utility statements), and in the server log
 *   of any failed `ALTER`. The verifier is the one form Postgres accepts that is not the secret:
 *   `PASSWORD 'SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>'` (`create_role.sgml`: a string
 *   already in SCRAM verifier format is stored as given).
 * ★ WIRE FORMAT AND MATH (`scram_protocols` / RFC 5802 / `auth-scram.c`): salt 16 bytes,
 *   iterations 4096 (both Postgres defaults), standard base64. SaltedPassword = PBKDF2-HMAC-SHA-256
 *   (password, salt, 4096, 32 bytes); ClientKey = HMAC(SaltedPassword, "Client Key"); StoredKey =
 *   SHA-256(ClientKey); ServerKey = HMAC(SaltedPassword, "Server Key").
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

const ITERATIONS = 4096;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

const hmac = (key: Buffer, label: string): Buffer =>
  createHmac('sha256', key).update(label, 'utf8').digest();

const b64 = (value: Buffer): string => value.toString('base64');

/**
 * `SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>` for one password. The salt is fresh per
 * call (same as `psql \password`); tests pass one to make the output deterministic.
 */
export const scramSha256Verifier = (password: string, salt?: Buffer): string => {
  const bytes = salt ?? randomBytes(SALT_BYTES);
  const saltedPassword = pbkdf2Sync(password, bytes, ITERATIONS, KEY_BYTES, 'sha256');
  const storedKey = createHash('sha256').update(hmac(saltedPassword, 'Client Key')).digest();
  const serverKey = hmac(saltedPassword, 'Server Key');
  return `SCRAM-SHA-256$${ITERATIONS}:${b64(bytes)}$${b64(storedKey)}:${b64(serverKey)}`;
};
