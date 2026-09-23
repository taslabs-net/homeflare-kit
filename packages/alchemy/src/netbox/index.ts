/**
 * NetBox providers for Alchemy.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY. These are
 *   the symbols a real stack consumes; the rest of the files are internals a provider needs but a
 *   consumer should not depend on. An `export *` here would publish every helper as API and make
 *   the next refactor a breaking change.
 * ★ The constraint reader IS exported, because a consumer writing its own family needs the same
 *   guard — and because a table nobody can reach is a table nobody uses.
 */
export {
  NETBOX_CONSTRAINTS,
  bodyViolations,
  constraintsFor,
  guardBody,
} from './constraint-guard.ts';
export {
  type EndpointConstraints,
  type EndpointKey,
  type NetboxBody,
  type ParamConstraint,
  refusal,
  violations,
} from './constraints.ts';
export { NETBOX_CONSTRAINTS_DIGEST } from './generated/constraints/index.ts';
export {
  NetboxPrefix,
  NetboxPrefixProvider,
  type PrefixAttributes,
  type PrefixProps,
  type PrefixStatus,
} from './prefix.ts';
export {
  LOCATE_PAGE,
  locateOne,
  type NetboxRequirements,
  type NetboxSpec,
  netboxHandlers,
  soleMatch,
} from './resource.ts';
