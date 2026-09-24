/**
 * `Podman.Container` props, attributes and the `.container` file renderer — the pure half of the
 * family, mirroring unit-form.ts's split for Systemd.Unit.
 *
 * ★ WHY THE `[Container]` SECTION IS TYPED, UNLIKE `Systemd.Unit`'s SECTIONS. unit-form.ts renders
 *   `[Unit]`/`[Service]`/`[Install]` verbatim because there is no machine-readable schema of
 *   `systemd.unit(5)` to check a key against. Quadlet's `[Container]` section is different: it is
 *   ONE vendor's documented, versioned surface — `podman-systemd.unit(5)`, Podman 5.4 (checked
 *   against `containers/podman` tag `v5.4.0`,
 *   `docs/source/markdown/podman-systemd.unit.5.md`, read 2026-09-24) — so every key below is
 *   checked against that page, not invented. `[Unit]`/`[Service]`/`[Install]` stay close to
 *   unit-form.ts's own verbatim-lines approach, because THOSE three sections are still systemd's
 *   own directive set, which Quadlet passes straight through (same doc, "All options and tables
 *   available in standard systemd unit files are supported").
 * ⛔ `[Container] Environment=` IS NEVER A SECRET — enforced in container-secrets.ts, called from
 *   `containerProblems` below. A container that needs a secret takes `EnvironmentFile=` pointing at
 *   a host path an out-of-band secret renderer (openbao-agent) maintains; this family never reads
 *   or renders that file's contents.
 * ⛔ `[Install]` SUPPORTS ONLY `Alias=`/`WantedBy=`/`RequiredBy=` FOR A `.container` FILE (same doc,
 *   "Currently, only the Alias, WantedBy and RequiredBy keys are supported") — NOT `Also=`, which
 *   plain `systemd.unit(5)` allows and unit-form.ts's `INSTALL_KEYS` therefore lists. See
 *   container-generator.ts's header for why there is no `enabled` prop at all.
 */
import { type UnitSection, configDigest, digestOf, renderUnit } from './unit-form.ts';
import { podmanArgsProblems, secretLikeEnvironment, secretLikeLines } from './container-secrets.ts';

/** ★ Reused, not redefined: same digest and `restartOn`-join contract as Systemd.Unit. */
export { configDigest, digestOf };

export type UnitLine = readonly [key: string, value: string];

/**
 * The `[Container]` keys this family supports — a deliberate SUBSET of the ~80 keys
 * `podman-systemd.unit(5)` documents (task scope: `Image`, `ContainerName`, `Network`, `Volume`,
 * `EnvironmentFile`, `Environment`, `PublishPort`, `Exec`, `User`, `AutoUpdate`, `PodmanArgs`).
 * Adding another key means adding a field here and checking it against the same doc — never a
 * free-text escape hatch, or `Environment=` secret-checking (below) could be bypassed through it.
 */
export type ContainerSection = {
  /** `Image=`. Required. "recommended to use a fully qualified image name" (doc). */
  readonly image: string;
  /** `ContainerName=`. @default quadlet's own `systemd-<name>` (doc) when omitted. */
  readonly containerName?: string;
  /** `Network=`. MUST support `'host'` — every container this rollout declares runs host netns. */
  readonly network?: string;
  /** `Volume=`, repeatable. */
  readonly volume?: readonly string[];
  /** `EnvironmentFile=`, repeatable. The ONLY way a secret reaches the container — see file header. */
  readonly environmentFile?: readonly string[];
  /** `Environment=`, repeatable `KEY=VALUE`. NEVER a secret — see container-secrets.ts. */
  readonly environment?: Readonly<Record<string, string>>;
  /** `PublishPort=`, repeatable. Refused together with `network: 'host'` — see `containerProblems`. */
  readonly publishPort?: readonly string[];
  /** `Exec=`. Appended after the image's entrypoint, "the same way as ... a Kubernetes pod" (doc). */
  readonly exec?: string;
  /** `User=`. The numeric UID inside the container (doc: "does not need to match the UID on the host"). */
  readonly user?: string;
  /** `AutoUpdate=`. Podman's own two values (doc): `'registry'` or `'local'`. */
  readonly autoUpdate?: 'registry' | 'local';
  /** `PodmanArgs=`, repeatable. Doc: "not recommended" — the generator does not understand it. */
  readonly podmanArgs?: readonly string[];
};

export type ContainerProps = {
  /** The Quadlet file's basename, WITHOUT `.container`. Written as `<name>.container`. */
  name: string;
  /** @default QUADLET_DEFAULT_DIRECTORY. Must be one of QUADLET_SEARCH_DIRECTORIES (below). */
  directory?: string;
  /** `[Unit]` — `Description=`/`Documentation=` typed, everything else verbatim (see file header). */
  unit?: { description?: string; documentation?: string; lines?: readonly UnitLine[] };
  /** `[Container]` — Quadlet's own, typed and doc-checked. */
  container: ContainerSection;
  /** `[Service]` — `Restart=`/`RestartSec=` typed, everything else verbatim. */
  service?: { restart?: string; restartSec?: string; lines?: readonly UnitLine[] };
  /** `[Install]` — the three keys Quadlet honours for a `.container` file (see file header). */
  install?: {
    wantedBy?: readonly string[];
    requiredBy?: readonly string[];
    alias?: readonly string[];
  };
  /** `systemctl start`/`stop` the GENERATED `<name>.service`. @default true. No `enabled` prop —
   *  see container-generator.ts's header for why boot-time enablement is not a systemctl call here. */
  started?: boolean;
  /** Same contract as Systemd.Unit's `restartOn`: digests of things read outside the `.container` file. */
  restartOn?: readonly string[];
};

export type ContainerAttributes = {
  name: string;
  /** The GENERATED unit's name: `<name>.service`. Never `.container` — systemctl never sees that. */
  serviceName: string;
  containerPath: string;
  /** SHA-256 of the `.container` file this resource wrote. */
  containerSha256: string;
  configSha256: string;
  loadState: string;
  activeState: string;
  unitFileState?: string;
  /** `systemctl show`'s `SourcePath=` on the generated unit — measured on CT100 2026-09-24 to be
   *  the `.container` file's own path; used to prove the generated unit is really ours. */
  sourcePath?: string;
  active: boolean;
};

/**
 * Podman's OWN rootful search path, most specific first — `podman-systemd.unit(5)`, "Podman Unit
 * Search Path", Podman 5.4, read 2026-09-24: "Quadlet files for the root user can be placed in the
 * following directories ordered in precedence" (`/run` over `/etc` over `/usr/share`).
 * ★ CT100's `caddy.container` lives in the middle one — measured live, `cat` over `ssh ct100`,
 *   2026-09-24: `/etc/containers/systemd/caddy.container`.
 * ⛔ A directory outside this list is invisible to Quadlet: the generator only reads these three, so
 *   a file elsewhere is a `.container` file with no `.service` ever generated from it — silently,
 *   unlike `Systemd.Unit`'s directory check, which at least writes a unit systemd could load if only
 *   it were enabled. See `containerProblems`.
 */
export const QUADLET_SEARCH_DIRECTORIES = [
  '/run/containers/systemd',
  '/etc/containers/systemd',
  '/usr/share/containers/systemd',
] as const;

export const QUADLET_DEFAULT_DIRECTORY = '/etc/containers/systemd';

/** ★ A conservative subset of what Quadlet itself accepts as a unit name: no template `@`, no `/`. */
export const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export const containerPathFor = (props: Pick<ContainerProps, 'name' | 'directory'>): string =>
  `${props.directory ?? QUADLET_DEFAULT_DIRECTORY}/${props.name}.container`;

/** The unit Quadlet generates FROM the `.container` file — systemctl only ever sees this name. */
export const serviceNameFor = (props: Pick<ContainerProps, 'name'>): string =>
  `${props.name}.service`;

const unitLines = (props: ContainerProps): UnitLine[] => [
  ...(props.unit?.description === undefined
    ? []
    : [['Description', props.unit.description] as UnitLine]),
  ...(props.unit?.documentation === undefined
    ? []
    : [['Documentation', props.unit.documentation] as UnitLine]),
  ...(props.unit?.lines ?? []),
];

const containerLines = (c: ContainerSection): UnitLine[] => [
  ['Image', c.image],
  ...(c.containerName === undefined ? [] : [['ContainerName', c.containerName] as UnitLine]),
  ...(c.network === undefined ? [] : [['Network', c.network] as UnitLine]),
  ...(c.user === undefined ? [] : [['User', c.user] as UnitLine]),
  ...(c.exec === undefined ? [] : [['Exec', c.exec] as UnitLine]),
  ...(c.autoUpdate === undefined ? [] : [['AutoUpdate', c.autoUpdate] as UnitLine]),
  ...(c.environmentFile ?? []).map((file): UnitLine => ['EnvironmentFile', file]),
  // ★ Sorted by key: a stable render for a plain object whose own key order JS does not promise.
  ...Object.keys(c.environment ?? {})
    .sort()
    .map((key): UnitLine => [
      'Environment',
      `${key}=${(c.environment as Record<string, string>)[key]}`,
    ]),
  ...(c.volume ?? []).map((volume): UnitLine => ['Volume', volume]),
  ...(c.publishPort ?? []).map((port): UnitLine => ['PublishPort', port]),
  ...(c.podmanArgs ?? []).map((arg): UnitLine => ['PodmanArgs', arg]),
];

const serviceLines = (props: ContainerProps): UnitLine[] => [
  ...(props.service?.restart === undefined ? [] : [['Restart', props.service.restart] as UnitLine]),
  ...(props.service?.restartSec === undefined
    ? []
    : [['RestartSec', props.service.restartSec] as UnitLine]),
  ...(props.service?.lines ?? []),
];

const installLines = (props: ContainerProps): UnitLine[] => [
  ...(props.install?.wantedBy ?? []).map((target): UnitLine => ['WantedBy', target]),
  ...(props.install?.requiredBy ?? []).map((target): UnitLine => ['RequiredBy', target]),
  ...(props.install?.alias ?? []).map((name): UnitLine => ['Alias', name]),
];

/** The whole `.container` file. ★ Reuses unit-form.ts's `renderUnit` — same `[Section]` INI shape. */
export const renderContainerFile = (props: ContainerProps): string => {
  const sections: UnitSection[] = [
    { name: 'Unit', lines: unitLines(props) },
    { name: 'Container', lines: containerLines(props.container) },
    { name: 'Service', lines: serviceLines(props) },
    { name: 'Install', lines: installLines(props) },
  ];
  return renderUnit(sections.filter((section) => section.lines.length > 0));
};

export const refuseContainer = (name: string, message: string): Error =>
  new Error(`Podman.Container ${name}: ${message}`);

/** Every refusal at once, so one plan shows the whole list — mirrors `unitProblems`'s shape. */
export const containerProblems = (props: ContainerProps): string[] => {
  const found: string[] = [];
  if (!NAME.test(props.name)) {
    found.push(
      `name must match ${String(NAME)}, with no '.container' suffix; got ${JSON.stringify(props.name)}`,
    );
  }
  const directory = props.directory ?? QUADLET_DEFAULT_DIRECTORY;
  if (!directory.startsWith('/') || directory.endsWith('/') || directory.includes('/..')) {
    found.push('directory must be an absolute, normalised path with no trailing slash');
  } else if (
    !QUADLET_SEARCH_DIRECTORIES.includes(directory as (typeof QUADLET_SEARCH_DIRECTORIES)[number])
  ) {
    found.push(
      `directory must be one of Quadlet's own rootful search path (${QUADLET_SEARCH_DIRECTORIES.join(', ')}); ` +
        `${directory} is never read by the generator (podman-systemd.unit(5), Podman 5.4).`,
    );
  }
  if (props.container.image.trim() === '') found.push('container.image is required');
  if (props.container.network === 'host' && (props.container.publishPort?.length ?? 0) > 0) {
    found.push(
      "container.publishPort has no effect with container.network 'host': the container already " +
        'binds the host’s ports directly. Drop publishPort, or use a different network.',
    );
  }
  found.push(
    ...secretLikeEnvironment(props.container.environment ?? {}).map(
      (problem) => `container.${problem}`,
    ),
  );
  found.push(
    ...podmanArgsProblems(props.container.podmanArgs ?? []).map(
      (problem) => `container.${problem}`,
    ),
  );
  // ★ Every OTHER rendered line — `Exec=`/`PodmanArgs=` and the `unit`/`service`/`install` escape
  //   hatches — checked too, so a secret cannot reach the file through a field this typed check does
  //   not otherwise inspect. `container.environment`'s OWN lines are excluded: `secretLikeEnvironment`
  //   above already checked them, with a better error message (the actual env var name).
  found.push(
    ...secretLikeLines([
      ...unitLines(props),
      ...containerLines(props.container).filter(([key]) => key !== 'Environment'),
      ...serviceLines(props),
      ...installLines(props),
    ]),
  );
  if (renderContainerFile(props).includes('\u0000'))
    found.push('the rendered .container file contains NUL');
  return found;
};
