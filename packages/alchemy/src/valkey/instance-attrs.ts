/**
 * `Valkey.Instance` props and attributes.
 *
 * ⛔ CREATE-AND-ASSERT, NEVER CREATE. A Valkey instance is a container the `Podman.Container`
 *   family owns (`homeflare-ct100/src/valkey.ts` already declares the two dormant Quadlets). This
 *   resource asserts a running instance's identity and configuration — it reads `INFO` and
 *   `CONFIG GET` — and refuses drift, never issues a `CONFIG SET` that could drop in-flight data.
 * ⛔ NO PASSWORD AS A PROP (S25). An instance's own admin password is the connection's concern
 *   (`connection.ts`), not a field stored in state; `Valkey.AclFile` owns the per-seat users.
 */
/** Declared, at-most-once-asserted properties of one running Valkey instance. */
export interface ValkeyInstanceProps {
  /** The instance's logical identity — matches the Quadlet's `containerName`. */
  readonly name: string;
  /** The TCP port the instance listens on (the Quadlet's `--port`). */
  readonly port: number;
  /** `maxmemory` (`CONFIG GET maxmemory`). A declaration may be unit form (`"512mb"`);
   * the live reply is the byte count. Compared with Valkey's `memtoull` rule. */
  readonly maxmemory?: string | undefined;
  /** `maxmemory-policy`, one of Valkey's eviction policies. */
  readonly maxmemoryPolicy?: string | undefined;
  /** `appendonly` (`yes`/`no`) — seat data is AOF, the LiteLLM cache is not. */
  readonly appendonly?: string | undefined;
}

/** Live attributes read back after reconcile. Never holds a password (see file header). */
export interface ValkeyInstanceAttributes {
  readonly name: string;
  readonly port: number;
  readonly version: string;
  readonly maxmemory: string;
  readonly maxmemoryPolicy: string;
  readonly appendonly: string;
}

/** The subset of `INFO` fields `read` needs. `port` is `tcp_port`, not the declared prop:
 * copying the declaration back would make a 6381 claim match a server on 6380. */
export interface ValkeyInstanceInfo {
  readonly version: string;
  readonly port: number;
}

/** The subset of `CONFIG GET` values `read` needs. */
export interface ValkeyInstanceConfig {
  readonly maxmemory: string;
  readonly maxmemoryPolicy: string;
  readonly appendonly: string;
}
