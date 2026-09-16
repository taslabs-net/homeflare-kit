/**
 * How a finished OpenBao HTTP exchange reads: a body, a genuinely absent object, or an error.
 *
 * ★ STATUS CODES, NEVER WORDS. The `bao` CLI this replaced reported every outcome as stderr text,
 *   and deciding by that text broke twice: every failure once read as absent (a bad token planned 33
 *   updates), and then `bao policy read` turned out to say "absent" in different words from
 *   `bao read`, so a new policy could not be created (b3c18a33e). The API itself answers 404 for
 *   absent, 403 for denied and 503 for sealed — openbao v2.6.2 sdk/logical/response_util.go:
 *   RespondErrorCommon (a read that finds nothing is 404; ErrPermissionDenied is 403) and
 *   AdjustErrorStatusCode (ErrSealed is 503).
 */

export type BaoIntent = 'read' | 'write' | 'delete';

/**
 * A failed call, naming the method, the path and OpenBao's own `errors` array.
 *
 * ⛔ IT NEVER CARRIES THE TOKEN, AND IT NEVER CARRIES A RESPONSE BODY IT DID NOT PARSE. It is built
 *   from the method, the API path and OpenBao's error strings only — no request, no headers, no
 *   `cause` — because an Effect `HttpClientRequest` inspects its headers through a redaction list
 *   that does not name `x-vault-token`. A 2xx body can hold a credential, and a foreign error page
 *   can echo the request back, so a body that is not OpenBao's is described, never quoted.
 */
export class BaoError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly errors: readonly string[],
  ) {
    const code = status === 0 ? 'no response' : String(status);
    super(`OpenBao ${method} /v1/${path} -> ${code}: ${errors.join('; ') || '(no errors given)'}`);
    this.name = 'BaoError';
  }
}

export type Settled =
  | { readonly body: Record<string, unknown> | undefined }
  | { readonly error: BaoError };

const objectOf = (text: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * OpenBao's `errors` array, or undefined for a body that is not OpenBao's.
 *
 * ★ EVERY ERROR OPENBAO WRITES IS `{"errors": [...]}` WITH A JSON CONTENT TYPE, 404 included —
 *   sdk/logical/response_util.go RespondError:180-196 — and every entry is a STRING.
 * ⛔ AN ARRAY WITH ANY NON-STRING ENTRY IS NOT OPENBAO. The first version filtered the non-strings
 *   out, which turned a JSON gateway's `{"errors":[{"code":1000,"message":"Not Found"}]}` into an
 *   empty OpenBao error list — and a 404 carrying it into "absent" on a read and "done" on a delete,
 *   the plan-CREATE-over-something-that-exists failure arriving through a wrong BAO_ADDR. Found by
 *   grok's review on 2026-09-14. An EMPTY array is still OpenBao's: a plain 404 carries exactly that.
 */
const errorsOf = (text: string): readonly string[] | undefined => {
  const raw = objectOf(text)?.['errors'];
  return Array.isArray(raw) && raw.every((entry) => typeof entry === 'string')
    ? (raw as string[])
    : undefined;
};

/**
 * Classify one exchange.
 *
 * ★ PURE AND EXPORTED SO THE ONE DECISION EVERY READ AND DELETE HERE RESTS ON CAN BE TESTED WITHOUT
 *   A VAULT. It has been wrong in both directions already — every failure once read as absent, and
 *   one command's absence wording was assumed for another's — see bao-status.test.ts.
 *
 * ⛔ 404 IS ABSENCE ONLY ON A READ, AND ONLY WHEN OPENBAO SAID IT. MEASURED 2026-09-13 with the CLI,
 *   and the discriminator is real but NARROW: a genuinely absent object, read by a token that IS
 *   allowed to read that path, is a 404. ⛔ AND THE SAME READ UNDER A NARROWER TOKEN IS A DENIAL:
 *   under the agent lane the identical read answered `Code: 403 … permission denied`, because the
 *   policy grants named paths and an unnamed one is refused rather than reported missing. So
 *   "absent" is only knowable to a caller that could have read it — which is exactly why 403 is an
 *   ERROR rather than a shrug. A resource that cannot tell absence from denial plans CREATE for
 *   something that exists, which is the failure this estate has now found four separate times.
 *   ⚠️ A 404 WHOSE BODY IS NOT `{"errors": […strings]}` IS NOT OPENBAO. A BAO_ADDR pointing at the
 *     wrong server — a reverse proxy's HTML 404, a gateway's JSON one — must not read as "nothing".
 *
 * 🔴 THE SHELL HELPER USED TO RETURN `''` FOR EVERY NON-ZERO EXIT, AND THAT IS A LIE WITH
 *   CONSEQUENCES. An expired BAO_TOKEN, a sealed server or a missing grant all came back as "the
 *   mount is not there", so `diff` answered `update`, `reconcile` ran `secrets enable`, and the plan
 *   reported a CREATE on infrastructure that exists. The failure the operator sees is about the
 *   wrong thing entirely, at the worst possible moment — a sealed vault. ⚠️ SO 403, 5xx AND ANYTHING
 *   ELSE THAT IS NOT 2xx FAILS. The cost is that a genuinely-absent read under a too-narrow token
 *   becomes an error instead of a create, and that is the right way round: "I could not tell" is a
 *   true statement, and "it is not there" was not.
 *
 * 🔴 THE DELETES ALL USED THE READ HELPER, WHICH DISCARDED THE EXIT CODE. A refused
 *   `secrets disable` was reported as a successful delete: the resource left Alchemy's state while
 *   the mount stayed live, so the next plan showed nothing and the object was orphaned in silence.
 *   ⚠️ ABSENCE IS STILL NOT AN ERROR FOR A DELETE, because a delete must be idempotent: Alchemy
 *   retries, and the second attempt legitimately finds nothing. So a delete's 404 is success and
 *   its 403 is not.
 * ★ DISABLING A MOUNT THAT IS ALREADY GONE IS NOT EVEN A 404. A review on 2026-09-14 said it failed
 *   with `no matching mount` and would wedge a retried delete. The server says otherwise: it answers
 *   success for a missing mount so as not to reveal whether one existed — openbao v2.6.2
 *   vault/logical_system.go:1211-1216 — and the CLI printed "Disabled the secrets engine (if it
 *   existed)" (command/secrets_disable.go:87).
 */
export const settle = (
  intent: BaoIntent,
  method: string,
  path: string,
  status: number,
  text: string,
): Settled => {
  const fail = (errors: readonly string[]) => ({
    error: new BaoError(status, method, path, errors),
  });
  if (status < 200 || status >= 300) {
    const errors = errorsOf(text);
    if (errors === undefined) {
      // ⛔ DESCRIBED, NEVER QUOTED. A proxy or gateway error page can echo the request back, headers
      //   and all, so quoting it could carry X-Vault-Token into an error that Alchemy logs (grok,
      //   2026-09-14). mint in house/proxmox/src/credentials.ts already did it this way.
      return fail([`not an OpenBao error body (${String(text.length)} bytes)`]);
    }
    if (status === 404 && intent !== 'write') return { body: undefined };
    return fail(errors);
  }
  // ★ A write or delete answering 204 has nothing to say. A READ with no body has told us nothing,
  //   and OpenBao never does that — a read that finds nothing is a 404 (RespondErrorCommon).
  if (text.trim() === '') {
    return intent === 'read' ? fail(['a successful read with an empty body']) : { body: undefined };
  }
  const body = objectOf(text);
  return body === undefined ? fail(['a success body that is not a JSON object']) : { body };
};
