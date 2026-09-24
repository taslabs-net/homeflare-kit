# Caddy's admin endpoint — `@homeflare/alchemy/caddy`

How the provider reaches Caddy's admin API, and what it refuses so a Caddyfile cannot cut it off.
The overview is [caddy.md](./caddy.md).

⛔ The admin API has no authentication. `localCaddyAdmin()` accepts only `http://` loopback
(`127.0.0.0/8`, `localhost`, `[::1]`) or `unix:///path`; the default is `http://127.0.0.1:2019`.

- **Host and Origin.** Caddy refuses a request whose `Host` is not an allowed origin (DNS-rebinding
  guard; measured on Caddy 2.11.4: `403 host not allowed`), and checks `Origin` when one is sent or
  `enforce_origin` is on. The transport sends both as the Caddy CLI does. A unix socket skips the
  Host check entirely.
- **`admin { origins … }`** narrowed, or **an SSH-forwarded port** (Caddy checks the Host against
  ITS port): pass `hostHeader: 'localhost:2019'`.
- **Another host's Caddy** (SSH later): forward its socket or port to loopback here and point a
  `localCaddyAdmin()` at it, or implement `CaddyTransport` over your own route. Never expose :2019.
- **A Caddyfile cannot strand the provider.** Before loading, the adapted `admin` block is refused
  if it turns the API off, listens off loopback or somewhere the transport does not reach (another
  port, socket or loopback address: `[::1]` is not `127.0.0.1`, and `localhost` binds IPv4), allows
  no Host the transport sends (its `origins`, or Caddy's loopback defaults when there are none), sets
  `enforce_origin` over a unix socket (no Origin is sent there), enables `remote`, or pulls config.
- ⛔ **No `admin` address means Caddy's default** (`localhost:2019`, or `$CADDY_ADMIN`) after the
  load. That is refused unless the transport is at that default: a Caddy reached on a socket or
  another port declares `admin <address>` in its Caddyfile.
