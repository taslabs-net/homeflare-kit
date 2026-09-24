/**
 * `ArgoCD.ApplicationSet` — one ApplicationSet, keyed by `metadata.name`.
 *
 * ★ WALKED 2026-09-24 against `@distilled.cloud/argocd@1.0.0-rc.12`: Distilled has
 *   `createApplicationSetService` (POST, `upsert` query), `getApplicationSetService`,
 *   `deleteApplicationSetService`. There is NO update operation — converge is create with
 *   `upsert: true`, the same seam Forgejo org secrets use for a PUT-only API.
 *
 * ⛔ ONLY THE GIT GENERATOR IS MODELED. Distilled also decodes list / cluster / matrix /
 *   merge / plugin / pullRequest / scmProvider / clusterDecisionResource. Those stay
 *   unbuilt until a stack declares one — see docs/argocd.md.
 *
 * ⛔ `defaultRemovalPolicy: 'retain'` — deleting an ApplicationSet deletes the Applications
 *   it generated. Opt in with `RemovalPolicy.destroy()`.
 */
import { adopt } from 'alchemy/AdoptPolicy';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as argocd from '@distilled.cloud/argocd';
import * as Effect from 'effect/Effect';
import {
  type ApplicationDestinationProps,
  type ApplicationSourceProps,
  destinationOf,
  destinationWire,
  sourceOf,
  sourceWire,
} from './application-form.ts';
import { type ArgoCDSpec, argocdHandlers } from './resource.ts';
import { bool, text } from './values.ts';

export interface ApplicationSetGitDirectory {
  path: string;
  exclude?: boolean;
}

export interface ApplicationSetGitGenerator {
  repoURL: string;
  revision?: string;
  directories?: ApplicationSetGitDirectory[];
}

export interface ApplicationSetTemplateProps {
  name: string;
  project?: string;
  source: ApplicationSourceProps;
  destination: ApplicationDestinationProps;
}

export interface ApplicationSetProps {
  name: string;
  goTemplate?: boolean;
  generators: { git: ApplicationSetGitGenerator }[];
  template: ApplicationSetTemplateProps;
}

export interface ApplicationSetAttributes {
  name: string;
  goTemplate: boolean;
  gitRepoURLs: string[];
  gitDirectories: string[];
  templateName: string;
  templateProject: string;
  templateSourceRepoURL: string;
  templateSourcePath: string;
  templateDestinationServer: string;
  templateDestinationNamespace: string;
}

export interface ArgoCDApplicationSet extends Resource<
  'ArgoCD.ApplicationSet',
  ApplicationSetProps,
  ApplicationSetAttributes,
  never
> {}

export const ArgoCDApplicationSet = Resource<ArgoCDApplicationSet>('ArgoCD.ApplicationSet', {
  defaultRemovalPolicy: 'retain',
});

export const isArgoCDApplicationSet = (value: unknown): value is ArgoCDApplicationSet =>
  typeof value === 'object' &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'ArgoCD.ApplicationSet';

const gitWire = (git: ApplicationSetGitGenerator): argocd.V1alpha1GitGenerator => ({
  repoURL: git.repoURL,
  ...(git.revision === undefined ? {} : { revision: git.revision }),
  ...(git.directories === undefined
    ? {}
    : {
        directories: git.directories.map((dir) => ({
          path: dir.path,
          ...(dir.exclude === undefined ? {} : { exclude: dir.exclude }),
        })),
      }),
});

const bodyOf = (props: ApplicationSetProps) => ({
  metadata: { name: props.name },
  spec: {
    generators: props.generators.map((generator) => ({ git: gitWire(generator.git) })),
    ...(props.goTemplate === undefined ? {} : { goTemplate: props.goTemplate }),
    template: {
      metadata: { name: props.template.name },
      spec: {
        destination: destinationWire(props.template.destination),
        project: props.template.project ?? 'default',
        source: sourceWire(props.template.source),
      },
    },
  },
});

const gitRepoURLs = (live: argocd.V1alpha1ApplicationSet): string[] =>
  (live.spec?.generators ?? [])
    .map((generator) => generator.git?.repoURL)
    .filter((url): url is string => typeof url === 'string')
    .toSorted();

const gitDirectories = (live: argocd.V1alpha1ApplicationSet): string[] =>
  (live.spec?.generators ?? [])
    .flatMap((generator) => generator.git?.directories ?? [])
    .map((dir) => text(dir.path))
    .filter((path) => path !== '')
    .toSorted();

export const spec: ArgoCDSpec<
  ApplicationSetProps,
  argocd.V1alpha1ApplicationSet,
  ApplicationSetAttributes,
  argocd.ArgocdOpError
> = {
  attributes: (live, props) => {
    const source = sourceOf(live.spec?.template?.spec?.source);
    const destination = destinationOf(live.spec?.template?.spec?.destination);
    return {
      gitDirectories: gitDirectories(live),
      gitRepoURLs: gitRepoURLs(live),
      goTemplate: bool(live.spec?.goTemplate),
      name: text(live.metadata?.name) || props.name,
      templateDestinationNamespace: destination.namespace,
      templateDestinationServer: destination.server,
      templateName: text(live.spec?.template?.metadata?.name),
      templateProject: text(live.spec?.template?.spec?.project) || 'default',
      templateSourcePath: source.path,
      templateSourceRepoURL: source.repoURL,
    };
  },
  create: (props) => argocd.createApplicationSetService(bodyOf(props)),
  describe: (props) => `applicationsets/${props.name}`,
  destroy: (props) => argocd.deleteApplicationSetService({ name: props.name }),
  fetchLive: (props) =>
    argocd
      .getApplicationSetService({ name: props.name })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: (attributes, props) => {
    const declaredRepos = props.generators.map((generator) => generator.git.repoURL).toSorted();
    const declaredDirs = props.generators
      .flatMap((generator) => generator.git.directories ?? [])
      .map((dir) => dir.path)
      .toSorted();
    if (declaredRepos.length !== attributes.gitRepoURLs.length) return false;
    if (declaredRepos.some((url, index) => url !== attributes.gitRepoURLs[index])) return false;
    if (declaredDirs.length !== attributes.gitDirectories.length) return false;
    if (declaredDirs.some((path, index) => path !== attributes.gitDirectories[index])) return false;
    if (props.goTemplate !== undefined && attributes.goTemplate !== props.goTemplate) return false;
    if (attributes.templateName !== props.template.name) return false;
    if (
      props.template.project !== undefined &&
      attributes.templateProject !== props.template.project
    )
      return false;
    if (attributes.templateSourceRepoURL !== props.template.source.repoURL) return false;
    if (
      props.template.source.path !== undefined &&
      attributes.templateSourcePath !== props.template.source.path
    )
      return false;
    if (
      props.template.destination.server !== undefined &&
      attributes.templateDestinationServer !== props.template.destination.server
    )
      return false;
    if (
      props.template.destination.namespace !== undefined &&
      attributes.templateDestinationNamespace !== props.template.destination.namespace
    )
      return false;
    return true;
  },
  /** Distilled has no ApplicationSet update — POST with `upsert=true` is the documented write. */
  update: (props) => argocd.createApplicationSetService({ ...bodyOf(props), upsert: true }),
};

export const handlers = argocdHandlers(spec);

export const ArgoCDApplicationSetProvider = () =>
  Provider.effect(ArgoCDApplicationSet, Effect.succeed(ArgoCDApplicationSet.Provider.of(handlers)));

export const applicationSet = (id: string, props: ApplicationSetProps) =>
  ArgoCDApplicationSet(id, props).pipe(adopt(true));
