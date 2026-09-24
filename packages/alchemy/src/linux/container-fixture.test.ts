/**
 * Renders the SAME directives as CT100's live `caddy.container`
 * (`/etc/containers/systemd/caddy.container`, read read-only over `ssh ct100` 2026-09-24) and checks
 * every line against that fixture.
 *
 * ⚠️ NOT BYTE-FOR-BYTE, AND HERE IS EXACTLY WHY NOT. `renderContainerFile` renders a TYPED
 *   `ContainerProps` — the whole point of this family (container-form.ts's header) — and CT100's
 *   file interleaves long prose comments BETWEEN directives inside `[Unit]` and `[Container]`
 *   (why host networking, the OpenBao-unreachable note, the rate-limit warning). There is nowhere
 *   in a typed prop to attach "this comment goes between EnvironmentFile= and Environment=": the
 *   comments are the file's OWN authored documentation, not data this resource's props carry.
 *   `Systemd.Unit` has the identical limit for the same reason — `unit-form.ts`'s `renderUnit`
 *   is lines-in-order with no comment slots either. So this fixture proves DIRECTIVE parity
 *   (every key, in a stable order, with CT100's exact values) rather than text-diff parity; the
 *   `[Unit]`/`[Service]`/`[Install]` VALUES below are copied verbatim from CT100's file, and the
 *   `[Container]` ones from CT100's `[X-Container]` section (Quadlet 5.x renders that heading;
 *   this family emits the pre-5.x `[Container]` spelling, both documented (podman-systemd.unit(5))).
 */
import { expect, test } from 'bun:test';
import { type ContainerProps, renderContainerFile } from './container-form.ts';

// ★ Copied verbatim from CT100's /etc/containers/systemd/caddy.container, 2026-09-24.
const caddy: ContainerProps = {
  container: {
    containerName: 'caddy',
    environment: { CADDY_CONFIG: '/etc/caddy/Caddyfile' },
    environmentFile: ['/etc/caddy/cf-token.env'],
    image: 'localhost/homeflare/caddy:2.11.4-hf1',
    network: 'host',
    volume: [
      '/etc/caddy/Caddyfile:/etc/caddy/Caddyfile:ro,Z',
      '/etc/caddy/rendered:/etc/caddy/rendered:ro,Z',
      '/etc/caddy/cf-token.env:/run/cf/token.env:ro',
      'caddy-data:/data',
      'caddy-config:/config',
    ],
  },
  install: { wantedBy: ['multi-user.target'] },
  name: 'caddy',
  service: { restart: 'always', restartSec: '5s' },
  unit: {
    description: 'HomeFlare TLS front door (Caddy, DNS-01)',
    documentation:
      'https://gitlab.homeflare.dev/homeflare/homeflare-config/-/tree/main/hosts/ct100/caddy',
    lines: [
      ['After', 'network-online.target'],
      ['Wants', 'network-online.target'],
      ['After', 'caddy-cf-token.service'],
      ['Wants', 'caddy-cf-token.service'],
    ],
  },
};

test('renders every directive CT100’s live caddy.container carries', () => {
  const rendered = renderContainerFile(caddy);
  const expected = [
    '[Unit]',
    'Description=HomeFlare TLS front door (Caddy, DNS-01)',
    'Documentation=https://gitlab.homeflare.dev/homeflare/homeflare-config/-/tree/main/hosts/ct100/caddy',
    'After=network-online.target',
    'Wants=network-online.target',
    'After=caddy-cf-token.service',
    'Wants=caddy-cf-token.service',
    '[Container]',
    'Image=localhost/homeflare/caddy:2.11.4-hf1',
    'ContainerName=caddy',
    'Network=host',
    'EnvironmentFile=/etc/caddy/cf-token.env',
    'Environment=CADDY_CONFIG=/etc/caddy/Caddyfile',
    'Volume=/etc/caddy/Caddyfile:/etc/caddy/Caddyfile:ro,Z',
    'Volume=/etc/caddy/rendered:/etc/caddy/rendered:ro,Z',
    'Volume=/etc/caddy/cf-token.env:/run/cf/token.env:ro',
    'Volume=caddy-data:/data',
    'Volume=caddy-config:/config',
    '[Service]',
    'Restart=always',
    'RestartSec=5s',
    '[Install]',
    'WantedBy=multi-user.target',
  ];
  for (const line of expected) expect(rendered).toContain(line);
  // Every non-blank, non-header line in our render is one of the expected lines — nothing invented.
  const ours = rendered.split('\n').filter((line) => line !== '' && !line.startsWith('['));
  expect(ours.sort()).toEqual(expected.filter((line) => !line.startsWith('[')).sort());
});

test('no comment lines — the one documented gap, not an accident', () => {
  // Quadlet accepts `#`/`;` comments in a .container file; renderUnit (unit-form.ts) never emits
  // one, in this family or Systemd.Unit's. CT100's own comments live only in the file this
  // resource would MANAGE, never in state — restating them is a future prop, not a bug here.
  expect(renderContainerFile(caddy)).not.toMatch(/^\s*[#;]/m);
});
