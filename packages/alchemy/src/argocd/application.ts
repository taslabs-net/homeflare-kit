/**
 * `ArgoCD.Application` — one Argo CD Application, keyed by `metadata.name`.
 *
 * ★ WALKED 2026-09-24 against `@distilled.cloud/argocd@1.0.0-rc.12` (not a live cluster):
 *   create is `POST /api/v1/applications`, get/update/delete use `/api/v1/applications/{name}`.
 *   Sync-relevant attrs are the `syncPolicy` the spec already carries — there is no separate
 *   `ArgoCD.Sync` resource; `syncApplicationService` is a one-shot operation, not desired state.
 *
 * ⛔ `defaultRemovalPolicy: 'retain'` — deleting an Application from the GitOps server drops
 *   the desired-state pointer for every resource it owns. Opt in with `RemovalPolicy.destroy()`.
 */
import { adopt } from 'alchemy/AdoptPolicy';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as argocd from '@distilled.cloud/argocd';
import * as Effect from 'effect/Effect';
import {
  type ApplicationDestinationAttributes,
  type ApplicationDestinationProps,
  type ApplicationSourceAttributes,
  type ApplicationSourceProps,
  type ApplicationSyncPolicyAttributes,
  type ApplicationSyncPolicyProps,
  destinationMatches,
  destinationOf,
  destinationWire,
  sourceMatches,
  sourceOf,
  sourceWire,
  syncPolicyMatches,
  syncPolicyOf,
  syncPolicyWire,
} from './application-form.ts';
import { type ArgoCDSpec, argocdHandlers } from './resource.ts';
import { text } from './values.ts';

export interface ApplicationProps {
  /** Application name — path key. Changing it is a replace, not an update. */
  name: string;
  /** AppProject this application belongs to. Empty / omitted means `default`. */
  project?: string;
  source: ApplicationSourceProps;
  destination: ApplicationDestinationProps;
  syncPolicy?: ApplicationSyncPolicyProps;
  /** Applications-in-any-namespace. Empty is the Argo CD control-plane namespace. */
  appNamespace?: string;
}

export interface ApplicationAttributes {
  name: string;
  project: string;
  source: ApplicationSourceAttributes;
  destination: ApplicationDestinationAttributes;
  syncPolicy: ApplicationSyncPolicyAttributes;
  uid: string;
  health: string;
  syncStatus: string;
}

export interface ArgoCDApplication extends Resource<
  'ArgoCD.Application',
  ApplicationProps,
  ApplicationAttributes,
  never
> {}

export const ArgoCDApplication = Resource<ArgoCDApplication>('ArgoCD.Application', {
  defaultRemovalPolicy: 'retain',
});

export const isArgoCDApplication = (value: unknown): value is ArgoCDApplication =>
  typeof value === 'object' &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'ArgoCD.Application';

const specOf = (props: ApplicationProps): argocd.V1alpha1ApplicationSpec => ({
  destination: destinationWire(props.destination),
  project: props.project ?? 'default',
  source: sourceWire(props.source),
  ...(syncPolicyWire(props.syncPolicy) === undefined
    ? {}
    : { syncPolicy: syncPolicyWire(props.syncPolicy) }),
});

export const spec: ArgoCDSpec<
  ApplicationProps,
  argocd.V1alpha1Application,
  ApplicationAttributes,
  argocd.ArgocdOpError
> = {
  attributes: (live, props) => ({
    destination: destinationOf(live.spec?.destination),
    health: text(live.status?.health?.status),
    name: text(live.metadata?.name) || props.name,
    project: text(live.spec?.project) || 'default',
    source: sourceOf(live.spec?.source),
    syncPolicy: syncPolicyOf(live.spec?.syncPolicy),
    syncStatus: text(live.status?.sync?.status),
    uid: text(live.metadata?.uid),
  }),
  create: (props) =>
    argocd.createApplicationService({
      metadata: { name: props.name },
      spec: specOf(props),
    }),
  describe: (props) => `applications/${props.name}`,
  destroy: (props) =>
    argocd.deleteApplicationService({
      name: props.name,
      ...(props.appNamespace === undefined ? {} : { appNamespace: props.appNamespace }),
    }),
  fetchLive: (props) =>
    argocd
      .getApplicationService({
        name: props.name,
        ...(props.appNamespace === undefined ? {} : { appNamespace: props.appNamespace }),
      })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: (attributes, props) =>
    (props.project === undefined || attributes.project === props.project) &&
    sourceMatches(attributes.source, props.source) &&
    destinationMatches(attributes.destination, props.destination) &&
    syncPolicyMatches(attributes.syncPolicy, props.syncPolicy),
  update: (props) =>
    argocd.updateApplicationService({
      application_metadata_name: props.name,
      metadata: { name: props.name },
      spec: specOf(props),
    }),
};

export const handlers = argocdHandlers(spec);

export const ArgoCDApplicationProvider = () =>
  Provider.effect(ArgoCDApplication, Effect.succeed(ArgoCDApplication.Provider.of(handlers)));

export const application = (id: string, props: ApplicationProps): ArgoCDApplication =>
  ArgoCDApplication(id, props).pipe(adopt(true));
