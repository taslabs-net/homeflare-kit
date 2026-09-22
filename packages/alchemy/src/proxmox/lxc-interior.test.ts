/**
 * PVE exposes no way to reach INSIDE a container, and this pins that as a measured fact rather
 * than a thing people keep re-deriving.
 *
 * ★ WHY A TEST AND NOT ONLY A DOC. `Proxmox.Lxc` declares a guest's PVE-level config and nothing
 *   within its filesystem, and every consumer that meets that limit goes looking for the resource
 *   that must surely exist — an exec, a file write, a cloud-init. It does not, for containers. A
 *   grep proves that once; this proves it on every run, and fails the day PVE adds one, which is
 *   exactly when the kit would want to wrap it.
 * ⛔ THE POSITIVE CONTROL IS LOAD BEARING. A test that only asserts absence passes for free if the
 *   generated file's comment shape ever changes. QEMU's `agent/exec` and `agent/file-write` are
 *   asserted present in the same pass, so a format change fails here instead of going quiet.
 * ⚠️ SIBLING FAMILIES ARE NOT AT PARITY. QEMU and LXC sit under the same `/nodes/{node}/…` tree
 *   and have completely different reach. Never infer one family's endpoints from the other's.
 */
import { describe, expect, test } from 'bun:test';

const schema = await Bun.file(new URL('./generated/pve.ts', import.meta.url)).text();

/** Every endpoint the generated schema documents, as `METHOD /path`. */
const endpoints = [...schema.matchAll(/(GET|POST|PUT|DELETE) (\/[A-Za-z0-9/{}_.-]+)/g)].map(
  (match) => `${match[1]} ${match[2]}`,
);

const under = (prefix: string) =>
  endpoints.filter((line) => line.slice(line.indexOf(' ') + 1).startsWith(prefix));

const LXC = '/nodes/{node}/lxc/{vmid}';
const QEMU = '/nodes/{node}/qemu/{vmid}';

describe('a container has no interior API', () => {
  test('the schema was parsed at all', () => {
    // ⛔ Without this, every absence assertion below would pass on an empty list.
    expect(endpoints.length).toBeGreaterThan(100);
    expect(under(LXC).length).toBeGreaterThan(20);
  });

  test('QEMU can exec and write files inside a guest — the positive control', () => {
    expect(under(QEMU)).toContain(`POST ${QEMU}/agent/exec`);
    expect(under(QEMU)).toContain(`POST ${QEMU}/agent/file-write`);
    expect(under(QEMU)).toContain(`GET ${QEMU}/agent/file-read`);
  });

  test('no LXC endpoint execs, reads or writes a file, or takes cloud-init', () => {
    // ⛔ So a generic, vendor-API-based Resource for a container's interior cannot be written:
    //    there is nothing to wrap. What is left is an image baked before create, a first-boot
    //    artifact, or a recorded human step — see docs/proxmox-lxc.md.
    const reaching = under(LXC).filter((line) =>
      /\/(agent|exec|file-read|file-write|cloudinit|cloud-init)(\/|$)/.test(line),
    );
    expect(reaching).toEqual([]);
  });

  test('the only LXC reach inside is an interactive console, which is not declarative', () => {
    // ⚠️ `termproxy` and `vncwebsocket` open a terminal for a person. They are not an API a
    //    resource can diff, and the kit wraps neither.
    const consoles = under(LXC).filter((line) => /(termproxy|vncwebsocket|spiceproxy)/.test(line));
    expect(consoles.length).toBeGreaterThan(0);
    expect(schema.includes('LxcExec')).toBe(false);
  });
});
