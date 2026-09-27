/** Pure target state and vendor guards, kept separate from the SDK lifecycle. */
import type {
  NotificationTargetAttributes,
  NotificationTargetProps,
} from './notification-target.ts';
import type { PveSpec } from './resource-spec.ts';
import { targetEndpoint } from './notification-target-endpoint.ts';
import { addressList, createShape, headerList, portOf, shape } from './notification-target-form.ts';
import { text } from './values.ts';

export const targetSpec: PveSpec<NotificationTargetProps, NotificationTargetAttributes> = {
  /**
   * ⛔ NAMED FIELDS, NEVER A SPREAD OF `live`. gotify's `token` and smtp's `password` really are
   *   absent from their read schemas — but webhook's read schema DECLARES `secret`, so "PVE will
   *   not hand it to us" is not a defence. Listing what is kept is what keeps secret material out
   *   of a state row, whatever a future PVE decides to start returning.
   */
  attributes: (live, props) => ({
    author: text(live['author']),
    body: text(live['body']),
    comment: text(live['comment']),
    disable: live['disable'] === 1 || live['disable'] === true,
    'from-address': text(live['from-address']),
    header: headerList(live['header']),
    mailto: addressList(live['mailto']),
    'mailto-user': addressList(live['mailto-user']),
    method: text(live['method']),
    mode: text(live['mode']),
    name: props.name,
    port: portOf(live['port']),
    server: text(live['server']),
    type: props.type,
    url: text(live['url']),
    username: text(live['username']),
  }),
  collection: (props) => `cluster/notifications/endpoints/${props.type}`,
  /** ⛔ `name` is create-only: PVE takes it in the body once, and in the path forever after. */
  createForm: createShape,
  /** ⚠️ A function, because the type picks the endpoint — see `targetEndpoint`. */
  endpoint: targetEndpoint,
  /**
   * Each line reads "not declared, or equal"; `disable` is the one field with no undeclared case.
   *
   * ⚠️ IF A PLAN NEVER SETTLES, SUSPECT A SCHEMA DEFAULT COMING BACK AS A VALUE. PVE defaults smtp
   *   `mode` to `tls` and smtp `author` to `Proxmox VE`, and applies both when the mail is sent
   *   rather than writing them into the config — so an undeclared field reads back empty and its
   *   line is skipped. A version that STORED them would answer with a field nobody declared. The
   *   fix is to declare the field, never to stop comparing it.
   */
  matches: (attributes, props) =>
    attributes.disable === (props.disable === true) &&
    (props.comment === undefined || attributes.comment === props.comment) &&
    (props.server === undefined || attributes.server === props.server) &&
    (props.port === undefined || attributes.port === props.port) &&
    (props.mode === undefined || attributes.mode === props.mode) &&
    (props.username === undefined || attributes.username === props.username) &&
    (props['from-address'] === undefined || attributes['from-address'] === props['from-address']) &&
    (props.author === undefined || attributes.author === props.author) &&
    (props.url === undefined || attributes.url === props.url) &&
    (props.method === undefined || attributes.method === props.method) &&
    (props.body === undefined || attributes.body === props.body) &&
    (props.mailto === undefined || attributes.mailto === addressList(props.mailto)) &&
    (props['mailto-user'] === undefined ||
      attributes['mailto-user'] === addressList(props['mailto-user'])) &&
    (props.header === undefined || attributes.header === headerList(props.header)),
  path: (props) => `cluster/notifications/endpoints/${props.type}/${props.name}`,
  updateForm: shape,
};
