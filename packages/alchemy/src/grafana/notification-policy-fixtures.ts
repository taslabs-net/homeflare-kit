/**
 * Shared fixtures for the `notification-policy*.test.ts` files — split to keep each file under
 * the house's 250-line cap. Deliberately NOT named `*.test.ts` — see `contact-point-fixtures.ts`'s
 * own header for why.
 */
export const PATH = '/api/v1/provisioning/policies';

export const liveTree = {
  group_by: ['alertname'],
  provenance: 'api',
  receiver: 'default-receiver',
  routes: [
    { matchers: ['severity=critical'], receiver: 'pagerduty' },
    { matchers: ['severity=warning'], receiver: 'slack' },
  ],
};

export const declaredRoute = {
  group_by: ['alertname'],
  receiver: 'default-receiver',
  routes: [
    { matchers: ['severity=critical'], receiver: 'pagerduty' },
    { matchers: ['severity=warning'], receiver: 'slack' },
  ],
};

export const props = { route: declaredRoute };
