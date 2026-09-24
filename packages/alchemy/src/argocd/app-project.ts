/**
 * `ArgoCD.AppProject` — one Argo CD AppProject, keyed by `metadata.name`.
 *
 * ★ WALKED 2026-09-24 against `@distilled.cloud/argocd@1.0.0-rc.12`: create is
 *   `POST /api/v1/projects` (`{ project, upsert }`), get/update/delete use
 *   `/api/v1/projects/{name}`. Roles, sync windows and signature keys exist on the SDK
 *   spec and stay unmodeled — a role JWT is a credential (S25), and sync windows are a
 *   follow-up once a stack actually declares one.
 *
 * ⛔ `defaultRemovalPolicy: 'retain'` — deleting a project orphans every Application that
 *   still names it. `delete` is fully implemented; opt in with `RemovalPolicy.destroy()`.
 */
import { adopt } from 'alchemy/AdoptPolicy';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as argocd from '@distilled.cloud/argocd';
import * as Effect from 'effect/Effect';
import {
  type ApplicationDestinationAttributes,
  type ApplicationDestinationProps,
  destinationOf,
  destinationWire,
} from './application-form.ts';
import { type ArgoCDSpec, argocdHandlers } from './resource.ts';
import { arraysEqual, stringArray, text } from './values.ts';

export interface AppProjectProps {
  /** Project name — path key. Changing it is a replace, not an update. */
  name: string;
  description?: string;
  /** Git / Helm URLs this project may pull from. `*` is Argo CD's own "any repo". */
  sourceRepos?: string[];
  destinations?: ApplicationDestinationProps[];
}

export interface AppProjectAttributes {
  name: string;
  description: string;
  sourceRepos: string[];
  destinations: ApplicationDestinationAttributes[];
}

export interface ArgoCDAppProject extends Resource<
  'ArgoCD.AppProject',
  AppProjectProps,
  AppProjectAttributes,
  never
> {}

export const ArgoCDAppProject = Resource<ArgoCDAppProject>('ArgoCD.AppProject', {
  defaultRemovalPolicy: 'retain',
});

export const isArgoCDAppProject = (value: unknown): value is ArgoCDAppProject =>
  typeof value === 'object' &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'ArgoCD.AppProject';

const destinationsOf = (
  live: argocd.V1alpha1ApplicationDestination[] | undefined,
): ApplicationDestinationAttributes[] => (live ?? []).map((row) => destinationOf(row));

const destinationsMatch = (
  attributes: ApplicationDestinationAttributes[],
  props: ApplicationDestinationProps[] | undefined,
): boolean => {
  if (props === undefined) return true;
  if (attributes.length !== props.length) return false;
  return props.every((declared, index) => {
    const live = attributes[index];
    if (live === undefined) return false;
    return (
      (declared.server === undefined || live.server === declared.server) &&
      (declared.name === undefined || live.name === declared.name) &&
      (declared.namespace === undefined || live.namespace === declared.namespace)
    );
  });
};

const projectBody = (props: AppProjectProps): argocd.V1alpha1AppProject => ({
  metadata: { name: props.name },
  spec: {
    ...(props.description === undefined ? {} : { description: props.description }),
    ...(props.destinations === undefined
      ? {}
      : { destinations: props.destinations.map(destinationWire) }),
    ...(props.sourceRepos === undefined ? {} : { sourceRepos: props.sourceRepos }),
  },
});

export const spec: ArgoCDSpec<
  AppProjectProps,
  argocd.V1alpha1AppProject,
  AppProjectAttributes,
  argocd.ArgocdOpError
> = {
  attributes: (live, props) => ({
    description: text(live.spec?.description),
    destinations: destinationsOf(live.spec?.destinations),
    name: text(live.metadata?.name) || props.name,
    sourceRepos: stringArray(live.spec?.sourceRepos),
  }),
  create: (props) => argocd.createProjectService({ project: projectBody(props) }),
  describe: (props) => `projects/${props.name}`,
  destroy: (props) => argocd.deleteProjectService({ name: props.name }),
  fetchLive: (props) =>
    argocd
      .getProjectService({ name: props.name })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: (attributes, props) =>
    (props.description === undefined || attributes.description === props.description) &&
    (props.sourceRepos === undefined ||
      arraysEqual(attributes.sourceRepos, stringArray(props.sourceRepos))) &&
    destinationsMatch(attributes.destinations, props.destinations),
  update: (props) =>
    argocd.updateProjectService({
      project: projectBody(props),
      project_metadata_name: props.name,
    }),
};

export const handlers = argocdHandlers(spec);

export const ArgoCDAppProjectProvider = () =>
  Provider.effect(ArgoCDAppProject, Effect.succeed(ArgoCDAppProject.Provider.of(handlers)));

export const appProject = (id: string, props: AppProjectProps) =>
  ArgoCDAppProject(id, props).pipe(adopt(true));
