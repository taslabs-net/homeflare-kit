/**
 * The read Bao.ProxmoxRole makes of `<mount>/roles/<name>`, split from proxmox-role.ts so the diff,
 * reconcile and the rename's re-scope check share one definition of "the live role".
 */
import * as Effect from 'effect/Effect';
import { baoRead } from './bao-http.ts';
import { type BaoProxmoxRoleProps, attributesOf, rolePath } from './proxmox-role-form.ts';

/**
 * The live role, or undefined when OpenBao answers 404.
 *
 * ⚠️ A missing MOUNT and a missing ROLE both read as undefined here, because both answer 404:
 *   an absent role is a read that found nothing, and a path under no mount is OpenBao's
 *   unsupported-path error, which is also a 404 (sdk/logical/response_util.go). They are not the
 *   same failure — one is a typo in `mount`, the other is a role that has yet to be created — so
 *   reconcile lets OpenBao's own `errors` through on the write rather than inventing a message.
 *   A bad mount says "no handler for route".
 */
export const readRole = (props: Pick<BaoProxmoxRoleProps, 'mount' | 'name'>) =>
  Effect.gen(function* () {
    const live = yield* baoRead(rolePath(props.mount, props.name));
    if (live === undefined) return undefined;
    return attributesOf(props, live);
  });
