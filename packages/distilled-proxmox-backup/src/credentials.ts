/**
 * Proxmox Backup Server credentials — hand-written.
 *
 * The `Credentials` service resolves `{ tokenId, secret, apiBaseUrl }` per
 * request; the protocol layer formats the `Authorization` header from it.
 *
 * ⛔ THE HEADER SCHEME IS NOT `PVEAPIToken=<id>=<secret>` — DO NOT COPY
 *   `packages/proxmox/src/credentials.ts`'s header-building line unchanged.
 *   PBS spells it `PBSAPIToken=<id>:<secret>`: a different prefix AND a
 *   different separator (colon, not `=`). Measured in
 *   `taslabs-net/homeflare-kit`'s `packages/alchemy/src/proxmox/
 *   credentials.ts` (`PBSAPIToken=${tokenId}:${secret}`, used unchanged
 *   since PVE/PBS share one client there) and independently in that same
 *   repo's `pbs-prune-job.ts` ("PBS's documented form is `Authorization:
 *   PBSAPIToken=TOKENID:TOKENSECRET`, measured from the published PBS
 *   documentation, 2026-09-13"). ⚠️ Both citations are REASONED FROM PBS'S
 *   DOCUMENTED SCHEME, NOT FROM A LIVE CALL — the kit's own comment says so
 *   explicitly ("the estate has no PBS credential yet ... an
 *   unauthenticated probe cannot tell the schemes apart"), and this
 *   package inherits that same caveat: nothing here has been exercised
 *   against a running PBS instance either (out of scope for this build —
 *   "No live PBS calls"). A wrong separator answers 401 "authentication
 *   failure", which reads as a bad credential rather than a malformed
 *   header — the first real token is what actually confirms this.
 *
 * PBS is self-hosted (a backup datastore host, not a single-tenant SaaS),
 * so — like PVE and `@distilled.cloud/forgejo` — there is no default API
 * root: the instance URL is part of the credential. `tokenId` is the FULL
 * `<user>@<realm>!<tokenid>` string PBS prints when an API token is created
 * (`proxmox-backup-manager user generate-token …`); `secret` is the value
 * shown exactly once at creation time.
 */
import * as EffectConfig from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ConfigError } from "@distilled.cloud/core/errors";

/**
 * PBS's own API root, relative to the host origin. Always `/api2/json` —
 * the same path PVE uses (both products share the same underlying
 * `proxmox-rest-server`-family REST framework; measured: the pinned PBS
 * schema's own endpoints are all rooted the same way PVE's are). The
 * default PORT differs (PBS is 8007, PVE 8006 — see
 * `taslabs-net/homeflare-kit`'s `docs/pbs-notifications.md` and its
 * `*.test.ts` fixtures, all `https://pbs.example.com:8007/api2/json`), but
 * this package never hardcodes a port: like PVE's own credentials.ts, the
 * instance URL (port included) is always part of the caller's credential.
 */
export const API_PATH = "/api2/json";

/**
 * Normalize a host origin (or an already-complete API root) into the API
 * base URL: trailing slashes dropped, {@link API_PATH} appended exactly
 * once. Does NOT default the port — `https://pbs.example.com:8007` (or a
 * bare host, which the caller must have already put a scheme+port on) is
 * expected.
 *
 * ⛔ THE TRIM IS A LOOP, NEVER `/\/+$/` — copied unchanged from
 *   `packages/proxmox/src/credentials.ts`: that regex backtracks
 *   polynomially on a long run of trailing `/` (CodeQL
 *   `js/polynomial-redos`), a real caller-input DoS surface, not a
 *   hypothetical one, and the fix already landed twice elsewhere in this
 *   clone (PVE, `@homeflare/distilled-netbox`).
 */
export const normalizeBaseUrl = (baseUrl: string): string => {
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47 /* "/" */) end--;
  const trimmed = baseUrl.slice(0, end);
  return trimmed.endsWith(API_PATH) ? trimmed : `${trimmed}${API_PATH}`;
};

export interface Config {
  /** The full `<user>@<realm>!<tokenid>` string, e.g. `root@pam!terraform`. */
  readonly tokenId: string;
  readonly secret: Redacted.Redacted<string>;
  /** Fully-qualified API root, e.g. `https://pbs1.example.com:8007/api2/json`. */
  readonly apiBaseUrl: string;
}

export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<Config>
>()("ProxmoxBackupCredentials") {}

/**
 * ⚠️ Distinct env var names from `@distilled.cloud/proxmox`'s
 *   `PROXMOX_TOKEN_ID`/`PROXMOX_TOKEN_SECRET`/`PROXMOX_URL`, on purpose — a
 *   process that talks to both a PVE cluster and a PBS datastore (a very
 *   plausible pairing: PBS backs up PVE) needs both sets live at once
 *   without collision. `PROXMOX_BACKUP_*` mirrors the package's own name,
 *   `@distilled.cloud/proxmox-backup`, rather than inventing a `PBS_*`
 *   prefix the vendor itself never uses in its own docs. This naming is
 *   this package's own choice, not a vendor-mandated one — flagged for
 *   confirmation in the build report.
 */
const envConfig = EffectConfig.all({
  tokenId: EffectConfig.String("PROXMOX_BACKUP_TOKEN_ID"),
  secret: EffectConfig.Redacted("PROXMOX_BACKUP_TOKEN_SECRET"),
  baseUrl: EffectConfig.String("PROXMOX_BACKUP_URL"),
});

export const CredentialsFromEnv = Layer.succeed(
  Credentials,
  envConfig.pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message:
            "PROXMOX_BACKUP_URL, PROXMOX_BACKUP_TOKEN_ID and PROXMOX_BACKUP_TOKEN_SECRET environment variables are required",
        }),
    ),
    Effect.map(({ tokenId, secret, baseUrl }) => ({
      tokenId,
      secret,
      apiBaseUrl: normalizeBaseUrl(baseUrl),
    })),
    Effect.orDie,
  ),
);

/** Convenience layer from a plain token and the host origin (or API root). */
export const credentials = (config: {
  readonly tokenId: string;
  readonly secret: string | Redacted.Redacted<string>;
  readonly baseUrl: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      tokenId: config.tokenId,
      secret:
        typeof config.secret === "string"
          ? Redacted.make(config.secret)
          : config.secret,
      apiBaseUrl: normalizeBaseUrl(config.baseUrl),
    }),
  );
