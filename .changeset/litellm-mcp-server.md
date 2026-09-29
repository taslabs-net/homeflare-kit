---
'@homeflare/alchemy': minor
---

Add `LiteLLM.MCPServer` (`@homeflare/alchemy/litellm`), one row of LiteLLM's MCP server table, on `@distilled.cloud/litellm`'s `mcp_management` operations (generated from LiteLLM v1.103.0, not measured against a live proxy). It adopts an existing row by `serverName` (or pins one by `serverId`), defaults to `retain`, and always compares the access grants (`allowAllKeys` defaults to `false`, `allowedTools`, `mcpAccessGroups`). A static credential is declared as `authValue: { fromEnv: 'NAME' }`, never a value, and a rotated credential is noticed through a salted seal; reading a server copies no credential, header or environment value, and a URL is redacted on the way in. It refuses `stdio`, a URL that carries a secret, and a static auth type without a credential, and reads back every write so a field the proxy did not apply fails the deploy.
