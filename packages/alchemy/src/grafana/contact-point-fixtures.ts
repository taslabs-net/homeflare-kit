/**
 * Shared fixtures for `contact-point.test.ts`/`contact-point-secrets.test.ts`/
 * `contact-point-provenance.test.ts` — split across three files to keep each under the house's
 * 250-line cap. Deliberately NOT named `*.test.ts`: importing one test file from another would
 * make `bun test`'s glob discovery execute its `describe` blocks twice (once directly, once as an
 * import side effect of the importing file) — this file has none to run, only plain data.
 */
export const LIST_PATH = '/api/v1/provisioning/contact-points';
export const ITEM_PATH = '/api/v1/provisioning/contact-points/slack-oncall';

export const liveJson = {
  disableResolveMessage: false,
  name: 'On-call Slack',
  provenance: 'api',
  settings: { recipient: '#oncall' },
  type: 'slack',
  uid: 'slack-oncall',
};

export const props = {
  name: 'On-call Slack',
  settings: { recipient: '#oncall' },
  type: 'slack',
  uid: 'slack-oncall',
};
