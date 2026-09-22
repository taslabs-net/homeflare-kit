/**
 * How a PBS notification target looks on the wire, and what of it may be remembered.
 *
 * ★ SPLIT OUT OF pbs-notification-target.ts FOR THE 250-LINE CAP, on the seam
 *   notification-target-form.ts cut for PVE: the resource file says what a target IS and when it
 *   changed; this file turns a live answer into attributes and a value into a wire item. The
 *   `import type` back is erased, so the cycle is on paper only.
 *
 * ⛔ THE LIVE ANSWER HOLDS HEADER VALUES, AND NONE OF THEM REACHES AN ATTRIBUTE. PBS returns a
 *   webhook's headers in full — `name=Authorization,value=<base64>` — to anyone with Sys.Audit on
 *   /system/notifications (proxmox-notify api/webhook.rs `get_endpoint`, read at HEAD 2026-09-22).
 *   Copying them into attributes would copy whatever a human pasted into a header, a bearer token
 *   included, into the unencrypted state store. So attributes keep header NAMES and a fixed-salt
 *   scrypt digest of the pairs (write-only.ts), enough to notice a change and nothing to send.
 * ⚠️ SECRETS ARE SAFER ON THE SERVER, AND THE READ SHOWS IT: `get_endpoint` blanks every secret's
 *   value and returns names only, from a root-only `notifications-priv.cfg`. A credential belongs
 *   in `secret` and is referenced as `{{ secrets.<name> }}` from a header, the URL or the body.
 */
import { Buffer } from 'node:buffer';
import { addressList, portOf } from './notification-target-form.ts';
import type {
  PbsNotificationTargetAttributes,
  PbsNotificationTargetProps,
} from './pbs-notification-target.ts';
import { bool, text } from './values.ts';
import { seal } from '../secrets/write-only.ts';

export const base64 = (value: string): string => Buffer.from(value, 'utf8').toString('base64');

/** ⚠️ Node's decoder skips characters it does not know rather than throwing, so this never throws. */
export const unbase64 = (value: string): string => Buffer.from(value, 'base64').toString('utf8');

/**
 * One `KeyAndBase64Val` property string — `name=<name>,value=<base64>` — split into its halves.
 * ⚠️ KEYED BY NAME, NOT BY POSITION: the server serialises `name` first today, and a parser that
 *   relied on that would read a reordered item as a header called `value=…`.
 * ★ A comma cannot occur inside either half: base64 has none, and `refusals` keeps names clean.
 */
export const keyAndValue = (item: string): { name: string; value?: string } => {
  const parts: Record<string, string> = {};
  for (const part of item.split(',')) {
    const at = part.indexOf('=');
    if (at > 0) parts[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  const value = parts['value'];
  return value === undefined ? { name: parts['name'] ?? '' } : { name: parts['name'] ?? '', value };
};

/** The wire item for one header or secret. The value is base64 — the server decodes it to use it. */
export const wireItem = (name: string, value: string): string =>
  `name=${name},value=${base64(value)}`;

const list = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.map((item: unknown) => String(item)) : [];

/** Sorted, comma-joined names — presence, the only thing the store may know about the values. */
export const names = (keys: readonly string[]): string =>
  [...keys]
    .filter((key) => key !== '')
    .sort()
    .join(',');

/**
 * ★ A FIXED SALT PER TARGET, SO AN UNCHANGED HEADER SET DIGESTS THE SAME ON EVERY READ. A random
 *   one would rewrite the state row on every plan. The server shows these values to its auditors
 *   anyway; what the salt and scrypt buy is that the STORE does not become a second, weaker copy.
 */
export const headerDigest = (target: string, pairs: Readonly<Record<string, string>>): string =>
  seal(pairs, `hf:pbs-notification-target:${target}:header`);

/**
 * Live JSON to attributes. `sealed` is left empty here: it is not the server's to report, and the
 * handlers in pbs-notification-target.ts carry it forward from the previous state.
 */
export const targetAttributes = (
  live: Record<string, unknown>,
  props: PbsNotificationTargetProps,
): PbsNotificationTargetAttributes => {
  const headers: Record<string, string> = {};
  for (const item of list(live['header'])) {
    const { name, value } = keyAndValue(item);
    if (name !== '') headers[name] = unbase64(value ?? '');
  }
  const secrets = list(live['secret']).map((item) => keyAndValue(item).name);
  return {
    author: text(live['author']),
    // ⚠️ DECODED, unlike the PVE family's: the server stores exactly the base64 it was handed and
    //   decodes it to render (endpoints/webhook.rs `build_request`), so decoding here is a pure
    //   function of what was written and `matches` compares readable text rather than base64.
    body: unbase64(text(live['body'])),
    comment: text(live['comment']),
    disable: bool(live['disable']),
    'from-address': text(live['from-address']),
    header: names(Object.keys(headers)),
    headerDigest: headerDigest(props.name, headers),
    mailto: addressList(live['mailto']),
    'mailto-user': addressList(live['mailto-user']),
    method: text(live['method']),
    mode: text(live['mode']),
    name: props.name,
    // ★ ON THE PER-OBJECT READ, MEASURED on PBS 4.2 (`notification endpoint sendmail show
    //   mail-to-root` answers `origin: builtin`). Reported, never compared.
    origin: text(live['origin']),
    port: portOf(live['port']),
    secret: names(secrets),
    sealed: '',
    server: text(live['server']),
    type: props.type,
    url: text(live['url']),
    username: text(live['username']),
  };
};
