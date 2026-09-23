/**
 * When a PBS notification target has changed, and the forms that change it.
 *
 * ★ THREE QUESTIONS, NOT ONE, because the three kinds of field can be checked three ways:
 *     plain   every field the server returns in full — compared by value, like any family here
 *     header  names from the read, values by digest (pbs-notification-target-wire.ts)
 *     sealed  secret values and the smtp password: the server returns names at best, so values
 *             are checked against the seal of what this provider last wrote (write-only.ts)
 *   Each answers `match`, `stale` or `unknown`; only `stale` writes. `unknown` is "the plan cannot
 *   see it" — a variable missing from the plan's environment, or a secret this provider never
 *   wrote (an adoption) — and it is PRESENCE-ONLY by design: a plan never invents drift it
 *   cannot see, and adoption stays free.
 *
 * ⛔ A WRITE SENDS ONLY THE GROUPS THAT ARE STALE. Omitting `header` or `secret` from a PUT keeps
 *   what the server holds (api/webhook.rs `update_endpoint`), so a changed comment is written
 *   without reading a single secret — and a deploy environment without the secrets can still
 *   repair the rest. A group that IS stale needs every value it holds; a missing one fails the
 *   deploy by variable name before anything is sent.
 */
import type { PveForm } from './client.ts';
import { literalCredentialHeaders, literalCredentialsInUrl } from './credential-literals.ts';
import { addressList } from './notification-target-form.ts';
import type {
  PbsNotificationTargetAttributes,
  PbsNotificationTargetProps,
} from './pbs-notification-target.ts';
import { base64, headerDigest, names, wireItem } from './pbs-notification-target-wire.ts';
import { type Environment, type FromEnv, resolveAll, sealMatches } from '../secrets/write-only.ts';

type Props = PbsNotificationTargetProps;
type Field = keyof Props;

/** Which family each optional field belongs to. A field outside its family is refused at plan. */
const OWNED: Readonly<Partial<Record<Field, readonly Props['type'][]>>> = {
  author: ['sendmail', 'smtp'],
  body: ['webhook'],
  'from-address': ['sendmail', 'smtp'],
  header: ['webhook'],
  mailto: ['sendmail', 'smtp'],
  'mailto-user': ['sendmail', 'smtp'],
  method: ['webhook'],
  mode: ['smtp'],
  password: ['smtp'],
  port: ['smtp'],
  secret: ['webhook'],
  server: ['smtp'],
  url: ['webhook'],
  username: ['smtp'],
};

const REQUIRED: Readonly<Record<Props['type'], readonly Field[]>> = {
  sendmail: [],
  smtp: ['server', 'from-address'],
  webhook: ['url', 'method'],
};

/** A header or secret name lands inside a property string, where `,` and `=` are syntax. */
const CLEAN_NAME = /^[^,=\s]+$/;

/** How a refused literal credential should be declared instead. */
const WRITE_ONLY =
  "declare it { fromEnv: 'NAME' }, or keep it in 'secret' and write {{ secrets.<name> }}";

/**
 * Why this declaration cannot be written, or nothing. Checked at PLAN, so a webhook without a
 * URL fails `alchemy plan` naming the field rather than a deploy failing on a 400.
 * ⚠️ "AT PLAN" MEANS `diff` FOR A TARGET WITH STATE AND THE ADOPTION PROBE (`read`) FOR ONE
 *   WITHOUT — pbs-notification-target-lifecycle.ts has why both are needed.
 */
export const refusals = (props: Props): string[] => {
  const out: string[] = [];
  for (const [field, types] of Object.entries(OWNED) as [Field, readonly Props['type'][]][]) {
    if (props[field] !== undefined && !types.includes(props.type)) {
      out.push(`'${field}' belongs to ${types.join('/')} targets, not ${props.type}`);
    }
  }
  for (const field of REQUIRED[props.type]) {
    if (props[field] === undefined || props[field] === '')
      out.push(`${props.type} needs '${field}'`);
  }
  for (const key of [...Object.keys(props.header ?? {}), ...Object.keys(props.secret ?? {})]) {
    if (!CLEAN_NAME.test(key)) out.push(`'${key}' cannot be a header or secret name`);
  }
  // ⛔ credential-literals.ts: a literal credential in a plain prop is a credential in state.
  for (const name of literalCredentialHeaders(props.header)) {
    out.push(`header '${name}' holds a literal credential; ${WRITE_ONLY}`);
  }
  for (const where of literalCredentialsInUrl(props.url)) {
    out.push(`'url' ${where} holds a literal credential; ${WRITE_ONLY}`);
  }
  return out;
};

const isFromEnv = (value: string | FromEnv): value is FromEnv => typeof value !== 'string';

/** Each group's values, resolved from `env`, plus the variables that were missing. */
export const resolveGroups = (props: Props, env: Environment = process.env) => {
  const headerRefs: Record<string, FromEnv> = {};
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(props.header ?? {})) {
    if (isFromEnv(value)) headerRefs[name] = value;
    else headers[name] = value;
  }
  const header = resolveAll(headerRefs, env);
  const sealedRefs: Record<string, FromEnv> = {};
  for (const [name, ref] of Object.entries(props.secret ?? {})) sealedRefs[`secret:${name}`] = ref;
  if (props.password !== undefined) sealedRefs['password'] = props.password;
  const sealed = resolveAll(sealedRefs, env);
  return {
    header: { missing: header.missing, values: { ...headers, ...header.values } },
    sealed,
  };
};

export type Groups = ReturnType<typeof resolveGroups>;
export type GroupState = 'match' | 'stale' | 'unknown';

const same = (declared: string | undefined, live: string): boolean =>
  declared === undefined || declared === live;

/** Every field the server returns in full. `disable` is the one with no undeclared case. */
export const plainMatches = (live: PbsNotificationTargetAttributes, props: Props): boolean =>
  live.disable === (props.disable === true) &&
  same(props.comment, live.comment) &&
  same(props.author, live.author) &&
  same(props['from-address'], live['from-address']) &&
  same(props.server, live.server) &&
  (props.port === undefined || props.port === live.port) &&
  same(props.mode, live.mode) &&
  same(props.username, live.username) &&
  same(props.url, live.url) &&
  same(props.method, live.method) &&
  same(props.body, live.body) &&
  (props.mailto === undefined || addressList(props.mailto) === live.mailto) &&
  (props['mailto-user'] === undefined || addressList(props['mailto-user']) === live['mailto-user']);

export const headerState = (
  live: PbsNotificationTargetAttributes,
  props: Props,
  groups: Groups,
): GroupState => {
  if (props.header === undefined) return 'match';
  if (names(Object.keys(props.header)) !== live.header) return 'stale';
  if (groups.header.missing.length > 0) return 'unknown';
  return headerDigest(props.name, groups.header.values) === live.headerDigest ? 'match' : 'stale';
};

export const sealedState = (
  live: PbsNotificationTargetAttributes,
  props: Props,
  groups: Groups,
  sealed: string,
): GroupState => {
  if (props.secret === undefined && props.password === undefined) return 'match';
  if (props.secret !== undefined && names(Object.keys(props.secret)) !== live.secret)
    return 'stale';
  if (groups.sealed.missing.length > 0 || sealed === '') return 'unknown';
  return sealMatches(sealed, groups.sealed.values) ? 'match' : 'stale';
};

/** Which write-only groups a write carries. A create carries every declared one. */
export interface Carry {
  readonly header: boolean;
  readonly sealed: boolean;
}

const secretItems = (props: Props, groups: Groups): string[] =>
  Object.keys(props.secret ?? {}).map((name) =>
    wireItem(name, groups.sealed.values[`secret:${name}`] ?? ''),
  );

const headerItems = (props: Props, groups: Groups): string[] =>
  Object.keys(props.header ?? {}).map((name) => wireItem(name, groups.header.values[name] ?? ''));

/** `''`/`[]` means "clear": dropped on a create, turned into a `delete` entry on an update. */
const plainPairs = (props: Props): [string, string | readonly string[]][] => [
  ['author', props.author ?? ''],
  ['body', props.body === undefined ? '' : base64(props.body)],
  ['comment', props.comment ?? ''],
  ['from-address', props['from-address'] ?? ''],
  ['method', props.method ?? ''],
  ['mode', props.mode ?? ''],
  ['port', props.port === undefined ? '' : String(props.port)],
  ['server', props.server ?? ''],
  ['url', props.url ?? ''],
  ['username', props.username ?? ''],
  ['mailto', props.mailto === undefined ? [] : addressList(props.mailto).split(',')],
  [
    'mailto-user',
    props['mailto-user'] === undefined ? [] : addressList(props['mailto-user']).split(','),
  ],
];

const declared = (props: Props, key: string): boolean =>
  (props as unknown as Record<string, unknown>)[key] !== undefined;

const empty = (value: string | readonly string[]): boolean =>
  typeof value === 'string' ? value === '' : value.filter((item) => item !== '').length === 0;

/**
 * The body of a create or an update — keys are the server's own, checked against generated/pbs.ts
 * by pbs-notification-target.test.ts. ⛔ `disable` IS ALWAYS SENT, `0` included — the PVE family's
 * reason: it is always compared, and "undeclared" and "false" must be one state, not a plan that
 * asks for an update the PUT never performs.
 */
export const targetForm = (
  props: Props,
  groups: Groups,
  carry: Carry,
  mode: 'create' | 'update',
): PveForm => {
  const form: Record<string, string | readonly string[]> = {
    disable: props.disable === true ? '1' : '0',
  };
  const cleared: string[] = [];
  const put = (key: string, value: string | readonly string[]) => {
    if (!empty(value)) form[key] = value;
    else if (mode === 'update') cleared.push(key);
  };
  for (const [key, value] of plainPairs(props)) if (declared(props, key)) put(key, value);
  if (carry.header && props.header !== undefined) put('header', headerItems(props, groups));
  if (carry.sealed && props.secret !== undefined) put('secret', secretItems(props, groups));
  if (carry.sealed && props.password !== undefined) {
    form['password'] = groups.sealed.values['password'] ?? '';
  }
  if (mode === 'create') form['name'] = props.name;
  if (cleared.length > 0) form['delete'] = cleared;
  return form;
};
