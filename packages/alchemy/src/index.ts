/**
 * @homeflare/alchemy — custom Alchemy providers for systems the vendor has none for.
 *
 * ⛔ IMPORT A SUBPATH, NOT THIS FILE. Each system carries its own peers and its own
 *   client; a root barrel would pull Proxmox into a stack that only wanted Forgejo.
 *
 *     import { R2BucketLock } from '@homeflare/alchemy/cloudflare';
 *     import { BranchProtection } from '@homeflare/alchemy/forgejo';
 *     import { BaoMount } from '@homeflare/alchemy/openbao';
 *     import { TalosCluster } from '@homeflare/alchemy/talos';
 *     import { ProxmoxAcl } from '@homeflare/alchemy/proxmox';
 *     import { LaunchdJob } from '@homeflare/alchemy/launchd';
 *     import { CaddyConfig } from '@homeflare/alchemy/caddy';
 *
 * ★ WHY THESE EXIST AT ALL. When Alchemy has no resource for something, the alternative
 *   is a runbook step a human runs once — and a plan can never show a missing runbook
 *   step. A custom provider makes the drift visible in `plan` like everything else.
 */

export {};
