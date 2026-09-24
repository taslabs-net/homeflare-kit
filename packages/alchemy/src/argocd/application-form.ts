/**
 * Shared Application source / destination / sync-policy mapping.
 *
 * ★ APPLICATION AND APPLICATIONSET BOTH CARRY THIS SHAPE. ApplicationSet's template.spec is the
 *   same `V1alpha1ApplicationSpec` Distilled decodes for Application. Mapping it once keeps the
 *   two resources from drifting on which undeclared fields they compare.
 *
 * ⛔ AN UNDECLARED FIELD IS NEITHER COMPARED NOR SENT — the rule every family in this package
 *   follows. Declaring only `repoURL` + `path` leaves Helm chart / kustomize / plugin alone.
 */
import type * as argocd from '@distilled.cloud/argocd';
import { bool, stringArray, text } from './values.ts';

export interface ApplicationSourceProps {
  /** Git or Helm repository URL. Changing it is an update, not a replace. */
  repoURL: string;
  /** Directory inside the git repo. Invalid for a Helm-chart source. */
  path?: string;
  /** Commit, tag, or branch. Omitted means HEAD (git) or the chart's latest (Helm). */
  targetRevision?: string;
  /** Helm chart name — required when the source is a Helm repo, not a git path. */
  chart?: string;
}

export interface ApplicationDestinationProps {
  /** In-cluster: `https://kubernetes.default.svc`. Named cluster alternative to `server`. */
  server?: string;
  /** Symbolic cluster name registered with Argo CD. Set this XOR `server`. */
  name?: string;
  namespace?: string;
}

export interface ApplicationSyncPolicyProps {
  automated?: {
    prune?: boolean;
    selfHeal?: boolean;
    allowEmpty?: boolean;
  };
  syncOptions?: string[];
}

export interface ApplicationSourceAttributes {
  repoURL: string;
  path: string;
  targetRevision: string;
  chart: string;
}

export interface ApplicationDestinationAttributes {
  server: string;
  name: string;
  namespace: string;
}

export interface ApplicationSyncPolicyAttributes {
  automated: boolean;
  prune: boolean;
  selfHeal: boolean;
  allowEmpty: boolean;
  syncOptions: string[];
}

export const sourceOf = (
  live: argocd.V1alpha1ApplicationSource | undefined,
): ApplicationSourceAttributes => ({
  chart: text(live?.chart),
  path: text(live?.path),
  repoURL: text(live?.repoURL),
  targetRevision: text(live?.targetRevision),
});

export const destinationOf = (
  live: argocd.V1alpha1ApplicationDestination | undefined,
): ApplicationDestinationAttributes => ({
  name: text(live?.name),
  namespace: text(live?.namespace),
  server: text(live?.server),
});

export const syncPolicyOf = (
  live: argocd.V1alpha1SyncPolicy | undefined,
): ApplicationSyncPolicyAttributes => ({
  allowEmpty: bool(live?.automated?.allowEmpty),
  automated: live?.automated !== undefined,
  prune: bool(live?.automated?.prune),
  selfHeal: bool(live?.automated?.selfHeal),
  syncOptions: stringArray(live?.syncOptions),
});

export const sourceWire = (props: ApplicationSourceProps): argocd.V1alpha1ApplicationSource => ({
  repoURL: props.repoURL,
  ...(props.chart === undefined ? {} : { chart: props.chart }),
  ...(props.path === undefined ? {} : { path: props.path }),
  ...(props.targetRevision === undefined ? {} : { targetRevision: props.targetRevision }),
});

export const destinationWire = (
  props: ApplicationDestinationProps,
): argocd.V1alpha1ApplicationDestination => ({
  ...(props.name === undefined ? {} : { name: props.name }),
  ...(props.namespace === undefined ? {} : { namespace: props.namespace }),
  ...(props.server === undefined ? {} : { server: props.server }),
});

export const syncPolicyWire = (
  props: ApplicationSyncPolicyProps | undefined,
): argocd.V1alpha1SyncPolicy | undefined => {
  if (props === undefined) return undefined;
  return {
    ...(props.automated === undefined
      ? {}
      : {
          automated: {
            ...(props.automated.allowEmpty === undefined
              ? {}
              : { allowEmpty: props.automated.allowEmpty }),
            ...(props.automated.prune === undefined ? {} : { prune: props.automated.prune }),
            ...(props.automated.selfHeal === undefined
              ? {}
              : { selfHeal: props.automated.selfHeal }),
          },
        }),
    ...(props.syncOptions === undefined ? {} : { syncOptions: props.syncOptions }),
  };
};

export const sourceMatches = (
  attributes: ApplicationSourceAttributes,
  props: ApplicationSourceProps,
): boolean =>
  attributes.repoURL === props.repoURL &&
  (props.path === undefined || attributes.path === props.path) &&
  (props.targetRevision === undefined || attributes.targetRevision === props.targetRevision) &&
  (props.chart === undefined || attributes.chart === props.chart);

export const destinationMatches = (
  attributes: ApplicationDestinationAttributes,
  props: ApplicationDestinationProps,
): boolean =>
  (props.server === undefined || attributes.server === props.server) &&
  (props.name === undefined || attributes.name === props.name) &&
  (props.namespace === undefined || attributes.namespace === props.namespace);

export const syncPolicyMatches = (
  attributes: ApplicationSyncPolicyAttributes,
  props: ApplicationSyncPolicyProps | undefined,
): boolean => {
  if (props === undefined) return true;
  if (props.automated !== undefined) {
    if (!attributes.automated) return false;
    if (props.automated.prune !== undefined && attributes.prune !== props.automated.prune)
      return false;
    if (props.automated.selfHeal !== undefined && attributes.selfHeal !== props.automated.selfHeal)
      return false;
    if (
      props.automated.allowEmpty !== undefined &&
      attributes.allowEmpty !== props.automated.allowEmpty
    )
      return false;
  }
  if (props.syncOptions !== undefined) {
    const declared = stringArray(props.syncOptions);
    if (declared.length !== attributes.syncOptions.length) return false;
    if (declared.some((option, index) => option !== attributes.syncOptions[index])) return false;
  }
  return true;
};
