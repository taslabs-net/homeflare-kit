---
'@homeflare/alchemy': minor
'@homeflare/config': patch
'@homeflare/distilled-caddy': patch
'@homeflare/distilled-grafana': patch
'@homeflare/distilled-litellm': patch
'@homeflare/distilled-netbox': patch
'@homeflare/distilled-openbao': patch
'@homeflare/distilled-opnsense': patch
'@homeflare/distilled-paperless-ngx': patch
'@homeflare/distilled-proxmox': patch
'@homeflare/distilled-proxmox-backup': patch
'@homeflare/distilled-unifi-network': patch
'@homeflare/seat-runtime': patch
'@homeflare/site': patch
---

Move to effect and `@effect/*` 4.0.1, alchemy 2.0.0-beta.81 and `@distilled.cloud/*` 1.0.0-rc.13. Consumers must install effect 4.0.1 (the peer was an exact rc.115): every import path moves from `effect/unstable/*` to `effect/*`. The distilled packages implement the `parseError` option distilled core rc.13 now requires of a REST protocol, raising each package's own `<Sdk>ParseError`. alchemy beta.81 probes a create whose props were Outputs at apply, so the ownership layer now answers `Unowned` to that apply-time read unless the plan proved the resume, forgets the row the engine's refusal leaves behind, and `Release.Binary` judges that create as a create: another owner's object, or other bytes at a binary path, are still refused without `--adopt`. `@homeflare/config` publishes the new `ESTATE_VERSIONS`.
