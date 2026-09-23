/**
 * The cluster-scoped families' REAL create forms, against the vendor's own tables.
 *
 * ⛔ THE RISK THIS FEATURE CARRIES IS NOT THE ONE IT FIXES. A table that refuses a declaration the
 *   vendor would have ACCEPTED blocks a deploy that was always legal, and the operator cannot tell
 *   that from a genuine violation. So every family wired on 2026-09-22 gets the same proof: build
 *   the form the provider really builds, run it through `formViolations(key, form, true)` — the
 *   create check, presence included — and require an empty result.
 *
 * ⛔ THE FORM, NEVER A RETYPED COPY OF IT. Four families built their create form inline in a spec
 *   literal; each one gained an exported builder that the provider now uses, so this file and the
 *   provider cannot disagree. A test that retypes the form proves the test.
 *
 * ★ THE NODE-SCOPED HALF IS IN constraints-node-forms.test.ts — split for the 250-line cap, on the
 *   same seam the generated tables are split on (`/cluster` and `/access` here, `/nodes/{node}`
 *   there).
 */
import { describe, expect, test } from 'bun:test';
import { shape as apiTokenForm } from './api-token-form.ts';
import { NETWORK_APPLY_ENDPOINT, SDN_APPLY_ENDPOINT } from './apply-endpoints.ts';
import { constraintsFor, formViolations } from './constraint-guard.ts';
import type { PveTarget } from './credentials.ts';
import { createBody as metricCreateForm } from './metric-server-form.ts';
import { createShape as targetCreateForm } from './notification-target-form.ts';
import { createForm as subnetCreateForm } from './sdn-subnet-form.ts';

const TARGET: PveTarget = { members: ['pve.test:8006'], mount: 'pve-test', scheme: 'pve' };

/** `formViolations` with presence — the create check, exactly as `resource-guard.ts` runs it. */
const onCreate = (key: string, form: Record<string, string | readonly string[]>) =>
  formViolations(key, form, true);

describe('Proxmox.ApiToken plans clean against POST /access/users/{userid}/token/{tokenid}', () => {
  /** ⚠️ `expire: 0` is "never", and PVE's `minimum: 0` accepts it — the bound the table carries. */
  test('the estate-shaped token declaration has no violations', () => {
    expect(
      onCreate(
        'pve:POST /access/users/{userid}/token/{tokenid}',
        apiTokenForm({
          comment: 'Declared by Alchemy',
          expire: 0,
          privsep: false,
          target: TARGET,
          tokenid: 'apply',
          userid: 'iac@pve',
        }),
      ),
    ).toEqual([]);
  });

  /** ⛔ `{userid}` AND `{tokenid}` ARE PATH SEGMENTS. A table that kept them would refuse every
   *   create for a "missing" parameter that was never missing (codegen/emit.ts). */
  test('neither path parameter is in the table', () => {
    const table = constraintsFor('pve:POST /access/users/{userid}/token/{tokenid}');
    expect(table['userid']).toBeUndefined();
    expect(table['tokenid']).toBeUndefined();
  });
});

describe('Proxmox.MetricServer plans clean against POST /cluster/metrics/server/{id}', () => {
  /**
   * The estate's own row, SHAPED: InfluxDB v2 over https with an api-path-prefix, an
   * organization and a bucket, every value a placeholder.
   *
   * ⛔ SHAPE ONLY, FOR THE REASON lxc-harness.ts GIVES. `src` ships in the npm tarball and this
   *   repository is public, so a real metrics host, cluster name or organization here would be
   *   estate topology published forever in the git history. The proof is about which KEYS the
   *   create form sends and which bounds they face; the strings carry none of it.
   */
  const declared = {
    'api-path-prefix': '/cluster-a/',
    bucket: 'pve',
    disable: false,
    id: 'metrics-example',
    influxdbproto: 'https',
    'max-body-size': 10_000_000,
    organization: 'example',
    port: 443,
    server: 'metrics.example.invalid',
    target: TARGET,
    type: 'influxdb',
    'verify-certificate': true,
  } as const;

  test('the live declaration has no violations', () => {
    expect(onCreate('pve:POST /cluster/metrics/server/{id}', metricCreateForm(declared))).toEqual(
      [],
    );
  });

  /** ⛔ PVE MARKS THREE PARAMETERS REQUIRED AND THE CREATE FORM SENDS ALL THREE. `id` is the path. */
  test('port, server and type are required and all three are sent', () => {
    const table = constraintsFor('pve:POST /cluster/metrics/server/{id}');
    expect(
      Object.entries(table)
        .filter(([, rule]) => rule.required)
        .map(([name]) => name),
    ).toEqual(['port', 'server', 'type']);
    expect(Object.keys(metricCreateForm(declared))).toContain('type');
  });

  test('a port past PVE own maximum is refused rather than sent', () => {
    expect(
      onCreate(
        'pve:POST /cluster/metrics/server/{id}',
        metricCreateForm({ ...declared, port: 70_000 }),
      ),
    ).toEqual(['port: at most 65536']);
  });
});

describe('Proxmox.NotificationTarget plans clean per family', () => {
  /** The shipped `mail-to-root`, edited — the shape every estate has. sendmail needs only a name. */
  test('the live sendmail declaration has no violations', () => {
    expect(
      onCreate(
        'pve:POST /cluster/notifications/endpoints/sendmail',
        targetCreateForm({
          comment: "Send mails to root@pam's email address",
          disable: false,
          mailto: ['someone@example.invalid'],
          'mailto-user': ['root@pam'],
          name: 'mail-to-root',
          target: TARGET,
          type: 'sendmail',
        }),
      ),
    ).toEqual([]);
  });

  test('an smtp target that declares its server and sender has no violations', () => {
    expect(
      onCreate(
        'pve:POST /cluster/notifications/endpoints/smtp',
        targetCreateForm({
          'from-address': 'pve@example.invalid',
          mode: 'tls',
          name: 'smtp-relay',
          port: 465,
          server: 'smtp.example.invalid',
          target: TARGET,
          type: 'smtp',
        }),
      ),
    ).toEqual([]);
  });

  /**
   * ⛔ THE ONE FAMILY THAT CANNOT SATISFY ITS OWN CREATE, PROVEN RATHER THAN ASSERTED IN PROSE.
   *   PVE requires gotify's `token` and it is a write-only secret, so it is not a prop — props are
   *   persisted to the state store unencrypted. `notification-target.ts` has said so in a comment
   *   since the family was written; this is the comment made executable.
   * ★ AND IT IS WHY THE CREATE CHECK IS CONDITIONAL. `resource-guard.ts` demands presence only
   *   when a create is really about to happen, so the documented workflow — create it out of band
   *   with its secret, then declare it — still plans clean. Asking to CREATE one fails at plan
   *   with the vendor's own word instead of a 400 half a deploy in.
   */
  test('a gotify create is refused for the token it may never carry', () => {
    expect(
      onCreate(
        'pve:POST /cluster/notifications/endpoints/gotify',
        targetCreateForm({
          name: 'gotify-house',
          server: 'https://gotify.example.invalid',
          target: TARGET,
          type: 'gotify',
        }),
      ),
    ).toEqual(['token: required']);
  });
});

describe('Proxmox.SdnSubnet plans clean against POST /cluster/sdn/vnets/{vnet}/subnets', () => {
  test('a declared subnet has no violations', () => {
    expect(
      onCreate(
        'pve:POST /cluster/sdn/vnets/{vnet}/subnets',
        subnetCreateForm({
          cidr: '192.0.2.0/24',
          gateway: '192.0.2.1',
          target: TARGET,
          vnet: 'vnet0',
          zone: 'zone0',
        }),
      ),
    ).toEqual([]);
  });

  /** ⚠️ `subnet` and `type` are the two PVE marks required, and `createForm` sends both. */
  test('subnet and type are required and both are sent', () => {
    const table = constraintsFor('pve:POST /cluster/sdn/vnets/{vnet}/subnets');
    expect(table['subnet']?.required).toBe(true);
    expect(table['type']).toMatchObject({ enum: ['subnet'], required: true });
  });
});

/**
 * ★ AN ACTION ENDPOINT IS WIRED TOO, AND THE TABLE IS SUPPOSED TO BE EMPTY. Neither apply takes a
 *   body, so there is nothing for a length or a range to be wrong about — the key exists so that
 *   `codegen/constraints.ts` resolves it against the vendor schema at generation time. A PVE that
 *   moves or withdraws either one fails `bun run check` rather than an `ifreload -a` on three
 *   nodes at once. ⛔ An empty table is NOT the same as a missing one: a missing one throws.
 */
describe('the two applies are wired although they carry no form', () => {
  test('both tables exist and both are empty', () => {
    expect(constraintsFor(NETWORK_APPLY_ENDPOINT)).toEqual({});
    expect(constraintsFor(SDN_APPLY_ENDPOINT)).toEqual({});
  });

  test('a key the generator never tabled is a defect that names the command', () => {
    expect(() => constraintsFor('pve:PUT /cluster/sdn/nope')).toThrow('bun codegen/constraints.ts');
  });
});

/**
 * ⛔ `Proxmox.CephFlag` HAS NO CREATE KEY, AND THAT IS THE VENDOR'S DOING. PVE registers only PUT
 *   on `/cluster/ceph/flags/{flag}`; `POST /cluster/ceph/flags` does not exist, which is why
 *   ceph-flag.ts documents its create branch as unreachable. Naming that POST would stop the
 *   generator — correctly — so the family declares the update alone.
 */
describe('Proxmox.CephFlag is wired through its PUT alone', () => {
  test('the update form passes, and value is the one rule PVE publishes', () => {
    expect(formViolations('pve:PUT /cluster/ceph/flags/{flag}', { value: '1' }, false)).toEqual([]);
    expect(constraintsFor('pve:PUT /cluster/ceph/flags/{flag}')).toEqual({
      value: { required: true, type: 'boolean' },
    });
  });
});
