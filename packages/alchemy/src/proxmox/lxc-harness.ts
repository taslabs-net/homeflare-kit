/**
 * Alchemy's real `Plan.make` and `apply` over fake-pve-lxc.ts, for the `Proxmox.Lxc` tests — the
 * mesh-node-harness.ts composition, with plan-only runs added because the adoption gate is a PLAN.
 *
 * ⛔ TEST-ONLY. No provider imports this file and it is not on the barrel.
 * ⛔ THE SHELL'S OPENBAO VARIABLES ARE REPLACED FOR THE LIFE OF EACH RUN. `mint` reads
 *   `BAO_AGENT_ADDR` before `BAO_ADDR`, and `BAO_TOKEN` rides every mint as a header; a developer
 *   shell with either set would otherwise send its real token to the fake, or its mint to a real
 *   agent. fake-bao-env.ts clears every BAO_* / VAULT_*, points BAO_ADDR at the fake, and
 *   restores them afterwards.
 * ★ WARNINGS ARE CAPTURED, because the drift warning in lxc.ts is the only thing a cold adoption
 *   plan says about a declaration that does not match yet (the plan itself reads `adopted`).
 * ★ ONE ARTIFACT STORE ACROSS A PLAN AND ITS APPLY, and `--adopt` as the AdoptPolicy service, as
 *   openbao/fake-stack.ts provides them: the ownership rule reads both (src/ownership/).
 */
import { AdoptPolicy, adopt } from 'alchemy/AdoptPolicy';
import { apply } from 'alchemy/Apply';
import { provideFreshArtifactStore } from 'alchemy/Artifacts';
import * as Plan from 'alchemy/Plan';
import { type CompiledStack, make as makeStack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import * as State from 'alchemy/State';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Logger from 'effect/Logger';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type { PveTarget } from './credentials.ts';
import { withFakeBao } from './fake-bao-env.ts';
import { FAKE_BAO, FAKE_MEMBER, type FakePve } from './fake-pve-lxc.ts';
import type { LxcProps } from './lxc-props.ts';
import { ProxmoxLxc, ProxmoxLxcProvider } from './lxc.ts';

export const TARGET: PveTarget = {
  members: [FAKE_MEMBER],
  mount: 'proxmox-lxc-test',
  scheme: 'pve',
};

/**
 * A PRODUCTION-SHAPED config — the same keys and the same spellings pvesh printed, PVE's defaults
 * written out — with every VALUE a placeholder: TEST-NET addresses, RFC 7042 documentation MACs,
 * and a made-up pool, VLAN, mount path, gid and sizes.
 * ⛔ SHAPE ONLY. This file ships in the npm tarball (`files` includes `src`), so nothing here may be
 *   the estate's real topology — sizes, VLANs and bridges included, not only addresses.
 */
export const LIVE: Readonly<Record<string, unknown>> = {
  arch: 'amd64',
  cores: 4,
  dev0: '/dev/dri/renderD128,uid=0,gid=44,mode=0660',
  dev1: '/dev/net/tun,uid=0,gid=0,mode=0666',
  features: 'nesting=1',
  hostname: 'ct-example',
  lxc: [['lxc.prlimit.memlock', 'unlimited']],
  memory: 8192,
  mp0: 'tank:subvol-900-disk-0,mp=/data,backup=0,size=200G',
  nameserver: '192.0.2.254',
  net0:
    'name=eth0,bridge=vmbr0,firewall=0,gw=192.0.2.1,hwaddr=00:00:5E:00:53:01,' +
    'ip=192.0.2.10/24,mtu=1500,tag=42,type=veth',
  net1: 'name=eth1,bridge=vmbr1,hwaddr=00:00:5E:00:53:02,ip=198.51.100.4/24,mtu=1500,type=veth',
  onboot: 1,
  ostype: 'debian',
  rootfs: 'local-zfs:subvol-900-disk-0,size=40G',
  searchdomain: 'example.com',
  swap: 0,
  tags: 'web',
  unprivileged: 1,
};

/** Where `seed` puts the production-shaped guest by default, and its `node/vmid` key. */
export const NODE = 'pve1';
export const VMID = 900;
export const KEY = `${NODE}/${String(VMID)}`;

/** The live config as a declaration: every key, minus what pvesh adds that is not a prop. */
export const pasted = (over: Partial<LxcProps> = {}): LxcProps => {
  const { lxc: _raw, ...config } = LIVE;
  return { ...(config as Partial<LxcProps>), node: NODE, target: TARGET, vmid: VMID, ...over };
};

/** Put `config` live on the fake as `node/vmid`, with a digest as PVE would add. */
export const seed = (fake: FakePve, node: string, vmid: number, config = LIVE) => {
  fake.guests.set(`${node}/${String(vmid)}`, { ...config, digest: 'digest-live' });
};

type Planned = { readonly action: string };
type PlanView = {
  readonly resources: Readonly<Record<string, Planned>>;
  readonly deletions: Readonly<Record<string, Planned | undefined>>;
};

/** What the CLI would set for one run: `adopt` is `--adopt`. */
export type RunOptions = { readonly adopt?: boolean };

export type Run = {
  /** Planned action per FQN, deletions included; empty when the plan itself failed. */
  readonly actions: Readonly<Record<string, string>>;
  /** The failure sentence, or `''`. */
  readonly failure: string;
  readonly warnings: readonly string[];
};

const withBaoEnv = <A>(body: () => Promise<A>): Promise<A> => withFakeBao(FAKE_BAO, body);

export const lxcEngine = (fake: FakePve) => {
  const rows: Record<string, Record<string, Record<string, State.ResourceState>>> = {};
  const state = Layer.succeed(State.State, State.InMemoryService(rows));
  const providers = ProxmoxLxcProvider().pipe(Layer.provideMerge(FetchHttpClient.layer));
  const run = (
    declare: Effect.Effect<unknown, unknown, unknown>,
    write: boolean,
    options: RunOptions,
  ) =>
    withBaoEnv(async (): Promise<Run> => {
      const warnings: string[] = [];
      const collect = Logger.make((options) => {
        if (options.logLevel === 'Warn') warnings.push(String(options.message));
      });
      const exit = await Effect.runPromiseExit(
        declare.pipe(
          makeStack({ name: 'lxc', providers, state }) as never,
          Effect.flatMap((compiled: CompiledStack) =>
            Plan.make(compiled).pipe(
              Effect.tap((planned) => (write ? apply(planned) : Effect.void)),
              provideFreshArtifactStore,
              Effect.provide(compiled.services),
            ),
          ),
          options.adopt === undefined
            ? (e) => e
            : Effect.provideService(AdoptPolicy, options.adopt),
          Effect.provide(Layer.succeed(Stage, 'test')),
          Effect.provide(Logger.layer([collect])),
          Effect.scoped,
          Effect.provideService(FetchHttpClient.Fetch, fake.fetch),
          // ⚠️ THE CAST IS AT THE ENGINE'S TYPED BOUNDARY (fake-stack.ts says why): the stack body
          //   is typed against every service a CLI run provides, and this run provides the few it uses.
        ) as unknown as Effect.Effect<PlanView, unknown>,
      );
      const actions: Record<string, string> = {};
      if (Exit.isSuccess(exit)) {
        for (const [fqn, node] of Object.entries(exit.value.resources)) actions[fqn] = node.action;
        for (const [fqn, node] of Object.entries(exit.value.deletions)) {
          if (node !== undefined) actions[fqn] = node.action;
        }
      }
      const failure = Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : '';
      return { actions, failure, warnings };
    });
  return {
    /** Plan only — what `alchemy plan` shows. Nothing is applied and no state is written. */
    plan: (declare: Effect.Effect<unknown, unknown, unknown>, options: RunOptions = {}) =>
      run(declare, false, options),
    /** Plan, then apply. */
    deploy: (declare: Effect.Effect<unknown, unknown, unknown>, options: RunOptions = {}) =>
      run(declare, true, options),
    /** The stored row's status, or undefined when there is none. */
    status: (fqn: string) => rows['lxc']?.['test']?.[fqn]?.status,
  };
};

/**
 * The engine, with the guest `seed` put at NODE/VMID adopted exactly as it runs — the only adoption
 * that proceeds (lxc-adoption.ts) — so a test can go on to change it, as an ordinary update.
 */
export const adoptedAsIs = async (pve: FakePve): Promise<ReturnType<typeof lxcEngine>> => {
  const stack = lxcEngine(pve);
  const run = await stack.deploy(ProxmoxLxc('ct', pasted()).pipe(adopt(true)));
  if (run.failure !== '') throw new Error(`the clean adoption failed: ${run.failure}`);
  return stack;
};
