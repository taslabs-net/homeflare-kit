/**
 * A tripwire for the obvious ways a secret ends up in Alchemy state through these providers.
 *
 * ⛔ WHY IT EXISTS. Alchemy persists every prop UNENCRYPTED in its state store — the same reason
 *   the OpenBao families are metadata-only (openbao/policy.ts). A LaunchdJob's `environment` and
 *   `programArguments`, and a HostFile's `content`, are props. A token declared there is a token
 *   copied into the state store, into every plan diff, and into the plist or file on disk.
 * ★ THE ALTERNATIVE, NAMED IN EVERY REFUSAL: let a secret renderer (openbao-agent, or any other)
 *   write the secret to a root-owned file, and declare only its PATH — `FOO_TOKEN_FILE=/path`,
 *   `--token-file /path`. The job reads the file at start; the state holds a path.
 *
 * ⚠️ A TRIPWIRE, NOT A SCANNER. It catches the names and shapes people actually type. A token in
 *   an innocently named variable passes; nothing here can make a secret safe to declare.
 */
import type { PlistDict, PlistValue } from './plist.ts';

const ALTERNATIVE =
  'props are stored unencrypted in Alchemy state. Have a secret renderer (e.g. openbao-agent) ' +
  'write it to a root-owned file and declare the file path instead (FOO_FILE=/path, --foo-file /path).';

/** Names that end in a word meaning "this is the secret itself". `*_FILE`, `*_PATH` never match. */
const SECRET_NAME =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|API_?KEY|ACCESS_KEY|PRIVATE_KEY|SECRET_KEY|CREDENTIALS?)$/i;

/** `--token=…` / `-password=…` style flags carrying their value inline. */
const INLINE_FLAG = /^--?[a-z0-9-]*(?:token|password|passwd|passphrase|secret|api-?key)=./i;

/** A flag whose NEXT argv element is the secret: `--token abc`. */
const BARE_FLAG = /^--?(?:[a-z0-9]+-)*(?:token|password|passwd|passphrase|secret|api-?key)$/i;

const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

/** Paths of every string leaf in a plist value holding a private key. */
const keyLeaves = (value: PlistValue, path: string): string[] => {
  if (typeof value === 'string') return PRIVATE_KEY.test(value) ? [path] : [];
  if (Array.isArray(value)) {
    return (value as readonly PlistValue[]).flatMap((item, index) =>
      keyLeaves(item, `${path}[${String(index)}]`),
    );
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => keyLeaves(item, `${path}.${key}`));
  }
  return [];
};

/**
 * Refusals for a job's environment, argv and extraKeys. Empty means nothing tripped.
 * ★ extraKeys too: it is a prop like the others, so it lands in state just the same.
 */
export const jobSecretProblems = (
  environment: Readonly<Record<string, string>> | undefined,
  argv: readonly string[],
  extraKeys?: PlistDict,
): string[] => {
  const found: string[] = [];
  for (const [name, value] of Object.entries(environment ?? {})) {
    if (SECRET_NAME.test(name))
      found.push(`environment ${name} looks like a secret: ${ALTERNATIVE}`);
    else if (PRIVATE_KEY.test(value))
      found.push(`environment ${name} holds a private key: ${ALTERNATIVE}`);
  }
  for (const [index, arg] of argv.entries()) {
    // ⛔ Never echo the argument itself: if it IS a secret, the refusal would print it.
    if (INLINE_FLAG.test(arg)) {
      found.push(`programArguments[${String(index)}] passes a secret inline: ${ALTERNATIVE}`);
    } else if (BARE_FLAG.test(arg) && index + 1 < argv.length) {
      found.push(`programArguments[${String(index + 1)}] follows a secret flag: ${ALTERNATIVE}`);
    } else if (PRIVATE_KEY.test(arg)) {
      found.push(`programArguments[${String(index)}] holds a private key: ${ALTERNATIVE}`);
    }
  }
  for (const path of keyLeaves(extraKeys ?? {}, 'extraKeys')) {
    found.push(`${path} holds a private key: ${ALTERNATIVE}`);
  }
  return found;
};

/** Refusals for a HostFile's content. */
export const fileSecretProblems = (content: string): string[] =>
  PRIVATE_KEY.test(content) ? [`content holds a private key: ${ALTERNATIVE}`] : [];
