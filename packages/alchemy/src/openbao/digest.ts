/**
 * The digest every Bao.* family persists instead of a value — moved here from the retired
 * bao-shell.ts, unchanged, when the package stopped shelling out to `bao`.
 */

/** ⚠️ Bun's hasher, not node:crypto — this runs under `bun --bun alchemy`. */
/**
 * The only form a policy body may be hashed or compared in.
 *
 * ⛔ OPENBAO STRIPS THE TRAILING NEWLINE AND THAT ALONE WAS A FOREVER-DIFF. MEASURED on the live
 *   server: the assembler emits each fragment followed by a newline, so `homeflare-llm` goes in as
 *   41 lines and `bao policy read` hands back 40 — identical text, one `\n` apart, two different
 *   digests. Every plan therefore reported `update`, every deploy rewrote the same policy, and the
 *   stack could never settle. It was invisible until the stack planned for the first time today.
 *   ★ THE HTTP API HANDS BACK THE SAME STRIPPED TEXT. `bao policy read` printed `data.policy` of
 *     `GET /v1/sys/policies/acl/<name>` (openbao v2.6.2 api/sys_policy.go:60-81), which is what
 *     policy-wire.ts now reads directly — so the canonicalisation is still load-bearing.
 *
 * ⚠️ `trimEnd` ONLY. Leading and interior whitespace are part of the HCL and must not be touched —
 *   a policy that differs by an indent really is a different document, and quietly folding that
 *   away would hide an edit rather than a formatting artifact.
 */
export const canonical = (text: string) => text.trimEnd();

export const sha256 = (text: string) =>
  new Bun.CryptoHasher('sha256').update(canonical(text)).digest('hex');
