/**
 * The site file: BASE VALUES and PINNED values, nothing derived.
 *
 * ★ BASE VALUES are the few things every name is relative to — the apex, a handful of
 *   labels, networks and hosts. `derive()` builds hostnames and addresses from them, so
 *   swapping the apex changes every derived name by substitution and nothing else.
 *
 * ⛔ PINNED VALUES ARE NEVER DERIVED. Physical names (Workers, D1, KV, R2, Durable Objects)
 *   follow no rule, and deriving one would REPLACE it: a derived D1 name deletes the data
 *   behind the old one. Certificate hostnames on adopted certificates reissue and revoke
 *   the certificate a host is still serving if they change. Adopted ids name objects that
 *   already exist. Policy and SSH principal lists are explicit so a break-glass principal
 *   can never vanish because a network leg was renamed.
 *
 * ⛔ UNKNOWN KEYS ARE REFUSED (see decode.ts). A misspelt optional field would otherwise
 *   decode as "absent" and the file would look valid while saying less than its author
 *   meant.
 */
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import {
  AbsolutePath,
  AccountId,
  CertificateName,
  GithubOwner,
  HostNumber,
  Hostname,
  Ipv4,
  Ipv4Cidr,
  Label,
  ListEntry,
  NonBlank,
  PhysicalName,
  PinKey,
  Port,
  SemVer,
} from './primitives.ts';

/** The site file format this package reads. A new format is a new literal, never a reuse. */
export const SITE_FORMAT = 1;

const emptyRecord = <S extends Schema.Top>(schema: S) =>
  schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed({})));

const Scheme = Schema.Literals(['http', 'https']);

/**
 * A machine. Its FQDN is `<key>.<zone>`; its address on a network is that network's base
 * plus `legs[network]`.
 * ★ `zone: "apex"` places the host directly under the apex (`docs.<apex>`).
 */
const Host = Schema.Struct({
  zone: Schema.optionalKey(Label),
  aliases: Schema.optionalKey(Schema.Array(Label)),
  legs: Schema.optionalKey(Schema.Record(Label, HostNumber)),
});

/** A public product: `<label ?? key>.<apex>`, or its own `domain`. Never both. */
const Product = Schema.Struct({
  label: Schema.optionalKey(Label),
  domain: Schema.optionalKey(Hostname),
});

/** An internal endpoint on a declared host. ⛔ The scheme is explicit, never guessed. */
const Service = Schema.Struct({ host: Label, port: Port, scheme: Scheme });

const Account = Schema.Struct({
  id: AccountId,
  zones: Schema.Array(Hostname),
  /** Each surface becomes an OpenBao mount `cloudflare-<alias>-<surface>`. */
  surfaces: Schema.Array(Label),
});

const Vault = Schema.Struct({
  /** `<vault-host>` = `<label>.<apex>`. */
  label: Label,
  /**
   * `<vault-api-host>` = `<apiLabel>.<vault-host>`.
   * ⚠️ NOT `vaultApi` beside a `vault` label. Measured 2026-09-21 on effect 4.0.0-rc.115:
   *   constant-cased env names nest by prefix, so `HF_SITE_VAULT_API` made the provider
   *   read `vault` as a record and the whole decode failed "Expected string". No field
   *   name here may be another's name plus `_…`; tests/overrides.test.ts asserts it.
   */
  apiLabel: Label,
  /**
   * ⛔ PINNED IDENTITY: the `cluster_name` the vault reports on `sys/health`. Set at init,
   *   never derived; plans compare it before touching anything (see identity.ts).
   */
  clusterName: NonBlank,
  namespace: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(''))),
  port: Port.pipe(Schema.withDecodingDefaultKey(Effect.succeed(8200))),
  /** The vault's address on the private Mesh path. Machines use it; strict TLS applies. */
  meshAddress: Ipv4,
  /** The LAN pass-through proxy: a declared host, its port, and its scheme. */
  lan: Schema.Struct({ host: Label, port: Port, scheme: Scheme }),
  oidcMount: Label.pipe(Schema.withDecodingDefaultKey(Effect.succeed('oidc'))),
  /** The port `bao login -method=oidc` listens on for its localhost callback. */
  cliCallbackPort: Port.pipe(Schema.withDecodingDefaultKey(Effect.succeed(8250))),
});

const Pinned = Schema.Struct({
  names: emptyRecord(Schema.Record(PinKey, PhysicalName)),
  certificates: emptyRecord(Schema.Record(PinKey, Schema.NonEmptyArray(CertificateName))),
  adopted: emptyRecord(Schema.Record(PinKey, NonBlank)),
  policies: emptyRecord(Schema.Record(PinKey, Schema.Array(ListEntry))),
  sshPrincipals: emptyRecord(Schema.Record(PinKey, Schema.Array(ListEntry))),
});

export const SiteSchema = Schema.Struct({
  /** The file format. Only {@link SITE_FORMAT} decodes. */
  version: Schema.Literal(SITE_FORMAT),
  /**
   * The `@homeflare/site` version whose derive rules this file was reviewed against.
   * ⛔ A repo refuses to load when its installed package differs (see guards.ts), so a
   *   derive change can never rename live objects without someone bumping this line.
   */
  deriveVersion: SemVer,
  /** ⛔ Only a `live` site may plan stage `live` (see guards.ts). */
  kind: Schema.Literals(['live', 'testing', 'example']),
  apex: Hostname,
  /**
   * Zone suffixes under the apex: `{ "mgmt": "mgmt" }` gives `mgmt.<apex>`.
   * ⛔ `mgmt` is required (it is `<mgmt-zone>`), and the key `apex` is reserved.
   */
  zones: Schema.StructWithRest(Schema.Struct({ mgmt: Label }), [Schema.Record(Label, Label)]),
  networks: Schema.Record(Label, Ipv4Cidr),
  hosts: Schema.Record(Label, Host),
  clusters: emptyRecord(Schema.Record(Label, Schema.Struct({ members: Schema.Array(Label) }))),
  products: emptyRecord(Schema.Record(Label, Product)),
  services: emptyRecord(Schema.Record(Label, Service)),
  cloudflare: Schema.Struct({
    accounts: Schema.Record(Label, Account),
    access: Schema.Struct({ team: Label }),
  }),
  github: Schema.Struct({ owner: GithubOwner }),
  paths: Schema.Struct({ estateRoot: AbsolutePath }),
  vault: Vault,
  pinned: Pinned.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
});

/** A decoded site: defaults applied, every value checked. */
export type Site = typeof SiteSchema.Type;
/** What a site file may contain before defaults are applied. */
export type SiteInput = typeof SiteSchema.Encoded;
