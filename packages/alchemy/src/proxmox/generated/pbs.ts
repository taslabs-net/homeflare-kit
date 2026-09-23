/**
 * Generated proxmox-backup-server API types — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/types.ts    (`--check` compares without writing)
 * Manifest entry: `pbs-apidoc` — proxmox-backup-server 4.2.6-1 (running 4.2.3)
 *   sha256 274ab9f6fc075aea, read on a PBS host from
 *   /usr/share/doc/proxmox-backup/html/api-viewer/apidoc.js
 *
 * 367 endpoints, 560 exported types: EVERY endpoint the vendor
 * documents, not a subset. The generator this replaced covered a fraction of them and no committed
 * file said which fraction or why.
 *
 * ⚠️ 151 request parameters are typed `\`${number}\`` because the vendor calls them
 *   integer or number. They were `string` before, which accepted 'banana'. A caller holding a
 *   number writes \`${n}\` — `String(n)` is a plain `string` and will not typecheck, deliberately.
 *
 * ⛔ 135 OF THESE NAMES ARE ALSO EXPORTED BY `pve.ts`, MEANING SOMETHING ELSE. Both
 *   products document a `/nodes/{node}` subtree, so a name like `NodesNodeCertificatesGetReturn`
 *   exists on each side — here an array of objects, there `null`. Nothing stops a pve call
 *   importing the pbs spelling: it compiles, and the type is simply wrong about the payload.
 *   Import from the barrel that names your product. tests/schema-types.test.ts pins this count, so
 *   a vendor upgrade that adds a collision fails there rather than at runtime.
 */
export * from './pbs/access.ts';
export * from './pbs/access-users.ts';
export * from './pbs/admin.ts';
export * from './pbs/admin-datastore-store.ts';
export * from './pbs/admin-metrics.ts';
export * from './pbs/backup.ts';
export * from './pbs/config.ts';
export * from './pbs/config-access.ts';
export * from './pbs/config-access-pam.ts';
export * from './pbs/config-datastore.ts';
export * from './pbs/config-media-pool.ts';
export * from './pbs/config-notifications.ts';
export * from './pbs/config-notifications-matchers.ts';
export * from './pbs/config-remote.ts';
export * from './pbs/config-sync.ts';
export * from './pbs/config-tape.ts';
export * from './pbs/config-verify.ts';
export * from './pbs/nodes.ts';
export * from './pbs/nodes-node.ts';
export * from './pbs/nodes-node-dns.ts';
export * from './pbs/nodes-node-services.ts';
export * from './pbs/ping.ts';
export * from './pbs/pull.ts';
export * from './pbs/push.ts';
export * from './pbs/reader.ts';
export * from './pbs/root.ts';
export * from './pbs/status.ts';
export * from './pbs/tape.ts';
export * from './pbs/tape-drive.ts';
export * from './pbs/tape-media.ts';
export * from './pbs/version.ts';
