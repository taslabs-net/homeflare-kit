/**
 * Shared fixtures for `alert-rule-group.test.ts`/`alert-rule-group-provenance.test.ts` — split to
 * keep each file under the house's 250-line cap. Deliberately NOT named `*.test.ts` — see
 * `contact-point-fixtures.ts`'s own header for why.
 */
export const PATH = '/api/v1/provisioning/folder/infra/rule-groups/default';

export const liveRule = {
  condition: 'A',
  data: [{ refId: 'A' }],
  execErrState: 'Alerting',
  folderUID: 'infra',
  for: '5m',
  id: 7,
  noDataState: 'NoData',
  orgID: 1,
  provenance: 'api',
  ruleGroup: 'default',
  title: 'High CPU',
  uid: 'high-cpu',
  updated: '2026-09-24T00:00:00Z',
};

export const liveJson = {
  folderUid: 'infra',
  interval: 60,
  rules: [liveRule],
  title: 'default',
};

export const ruleInput = {
  condition: 'A',
  data: [{ refId: 'A' }],
  execErrState: 'Alerting',
  for: '5m',
  noDataState: 'NoData',
  title: 'High CPU',
  uid: 'high-cpu',
};

export const props = {
  folderUid: 'infra',
  group: 'default',
  interval: 60,
  rules: [ruleInput],
};
