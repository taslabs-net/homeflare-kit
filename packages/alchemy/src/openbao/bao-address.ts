/**
 * Where an OpenBao call goes and which headers it carries — resolved from the environment the way
 * the `bao` CLI resolves it, so the provider and `bao kv get` can never disagree about which server
 * or namespace this machine is talking to.
 *
 * ★ READ FROM openbao v2.6.2, NOT RECALLED:
 *   · api/client.go:34-66 — BAO_ADDR, BAO_AGENT_ADDR, BAO_NAMESPACE, BAO_TOKEN, and the header
 *     names `X-Vault-Namespace` and `X-Vault-Token`.
 *   · api/client.go:370 — the default address, `https://127.0.0.1:8200`.
 *   · api/client.go:503-507, 617-618, 761-762 — BAO_AGENT_ADDR, when set, WINS over BAO_ADDR.
 *   · api/env.go:22-34 — every BAO_* falls back to its VAULT_* twin, but a BAO_* that is present
 *     and EMPTY still wins over the VAULT_* one.
 *   · api/client.go:776-785 — the token and namespace are applied only when non-empty, and every
 *     request carries `X-Vault-Request: true`.
 *   · api/client.go:1349-1354 — the request path is joined onto the address's own path.
 *
 * ⛔ WHAT THE CLI DOES AND THIS DELIBERATELY DOES NOT: with BAO_TOKEN unset, `bao` falls back to its
 *   token helper (a token file in $HOME). This never reads that file. No BAO_TOKEN means AGENT
 *   MODE — see `headersFor`.
 * ⚠️ NOT CARRIED OVER: BAO_CACERT / BAO_SKIP_VERIFY / client certificates, SRV lookup, and the CLI's
 *   retries on 5xx. An https address needs a certificate the runtime already trusts; a TLS failure
 *   fails the call loudly rather than being skipped.
 */

export type BaoEnvironment = Readonly<Record<string, string | undefined>>;

export type BaoAddress = {
  /** Scheme, host and any path prefix, no trailing slash. `http://localhost` for a socket. */
  readonly base: string;
  /** The socket path when the address is `unix:///path`, otherwise undefined. */
  readonly socket: string | undefined;
  /** The namespace to send, when there is one. */
  readonly namespace: string | undefined;
};

export const DEFAULT_ADDRESS = 'https://127.0.0.1:8200';

const UNIX = 'unix://';

/** api/env.go ReadBaoVariable: present (even empty) BAO_* wins, else the VAULT_* twin. */
export const readBaoVariable = (env: BaoEnvironment, name: `BAO_${string}`): string =>
  env[name] ?? env[`VAULT_${name.slice('BAO_'.length)}`] ?? '';

/**
 * The address and namespace for this environment. Carries no token, so it is safe to log.
 *
 * ★ UNIX SOCKETS, BECAUSE AN AGENT LISTENER CAN BE ONE. OpenBao Agent's `listener "unix"` serves
 *   the same API on a socket (website/content/docs/agent-and-proxy/agent/index.mdx:382-384), and the
 *   agent advertises such a listener as `unix://<path>` (command/agent.go:565-566). The CLI handles
 *   that address by dialling the socket and speaking plain HTTP to host `localhost`
 *   (api/client.go:654-667); `base` and `socket` are exactly those two halves.
 */
export const resolveAddress = (env: BaoEnvironment): BaoAddress => {
  const agent = readBaoVariable(env, 'BAO_AGENT_ADDR');
  const direct = readBaoVariable(env, 'BAO_ADDR');
  const raw = agent !== '' ? agent : direct !== '' ? direct : DEFAULT_ADDRESS;
  const namespace = readBaoVariable(env, 'BAO_NAMESPACE');
  const socket = raw.startsWith(UNIX) ? raw.slice(UNIX.length) : undefined;
  return {
    base: socket === undefined ? raw.replace(/\/+$/, '') : 'http://localhost',
    namespace: namespace === '' ? undefined : namespace,
    socket,
  };
};

/**
 * The headers one call sends.
 *
 * ★ AGENT MODE IS "NO TOKEN HEADER AT ALL", AND THAT IS THE AGENT'S OWN CONTRACT. Read in openbao
 *   v2.6.2 command/agentproxyshared/cache/handler.go:29-38: the proxy handler takes the request's
 *   `X-Vault-Token`, and only when it is EMPTY and an auto-auth sink exists does it substitute the
 *   agent's own token. command/agent.go:517-541 creates that sink exactly when
 *   `api_proxy { use_auto_auth_token = true }` is set; command/agent/config/config.go:288-292 and
 *   635-637 map the older `cache { use_auto_auth_token }` onto the same setting; and
 *   command/proxy.go:495-518 wires OpenBao Proxy identically. The docs say the same in words
 *   (website/content/docs/agent-and-proxy/agent/apiproxy.mdx:57-62): a request without a token is
 *   forwarded with the auto-auth token, a request that bears one keeps its own, and `"force"`
 *   overwrites it.
 *   ⛔ SO AN EMPTY `X-Vault-Token: ` WOULD BE WRONG IN BOTH DIRECTIONS: harmless to the agent,
 *     which reads empty as absent, but an explicit unauthenticated request to a server. The header
 *     is omitted, never blanked.
 * ★ THE NAMESPACE RIDES THROUGH THE AGENT UNTOUCHED. The proxy clones its client and replaces that
 *   client's headers with the incoming request's (cache/api_proxy.go:50-54 and :78), so the
 *   `X-Vault-Namespace` sent here is the one OpenBao sees.
 * ⚠️ `X-Vault-Request: true` IS NOT DECORATION. An agent listener with `require_request_header`
 *   refuses any request without it (command/agent.go:544-548); the CLI always sends it.
 *
 * ⛔ THE RETURN VALUE HOLDS THE TOKEN. Hand it to the request and nowhere else: never to an error,
 *   a log line, an attribute, or a span — bao-http.ts adds the header to the redacted names.
 */
export const headersFor = (address: BaoAddress, env: BaoEnvironment): Record<string, string> => {
  const headers: Record<string, string> = { 'X-Vault-Request': 'true' };
  if (address.namespace !== undefined) headers['X-Vault-Namespace'] = address.namespace;
  const token = readBaoVariable(env, 'BAO_TOKEN');
  if (token !== '') headers['X-Vault-Token'] = token;
  return headers;
};
