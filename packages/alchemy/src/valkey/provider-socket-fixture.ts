/** Test-only RESP listener around the stateful fake. Listener EPERM is a test failure. */
import * as Effect from 'effect/Effect';
import { type Socket, createServer } from 'node:net';
import { type FakeValkey, makeFakeValkey } from './fake-valkey.ts';
import type { ValkeyReply } from './transport.ts';

const bulk = (value: string | null): string =>
  value === null ? '$-1\r\n' : `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
const encode = (reply: ValkeyReply): string => {
  if (reply.kind === 'error') return `-${reply.message}\r\n`;
  if (reply.kind === 'bulk') return bulk(reply.value);
  return `*${reply.values.length}\r\n${reply.values.map(bulk).join('')}`;
};

const command = (buf: Buffer): { args: string[]; bytes: number } | undefined => {
  const end = buf.indexOf('\r\n');
  if (end < 0) return undefined;
  const count = Number(buf.subarray(1, end).toString());
  const args: string[] = [];
  let offset = end + 2;
  for (let i = 0; i < count; i++) {
    const lengthEnd = buf.indexOf('\r\n', offset);
    if (lengthEnd < 0) return undefined;
    const length = Number(buf.subarray(offset + 1, lengthEnd).toString());
    const start = lengthEnd + 2;
    if (buf.length < start + length + 2) return undefined;
    args.push(buf.subarray(start, start + length).toString());
    offset = start + length + 2;
  }
  return { args, bytes: offset };
};

export interface ProviderServer {
  readonly fake: FakeValkey;
  readonly port: number;
  readonly close: () => Promise<void>;
}

export const providerServer = (user: string): Promise<ProviderServer> =>
  new Promise((resolve, reject) => {
    const fake = makeFakeValkey({ acl: { [user]: `user ${user} on nopass -@all` } });
    const peers = new Set<Socket>();
    const server = createServer((peer) => {
      peers.add(peer);
      peer.on('close', () => peers.delete(peer));
      let pending = Buffer.alloc(0);
      peer.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        let parsed = command(pending);
        while (parsed !== undefined) {
          pending = pending.subarray(parsed.bytes);
          peer.write(encode(Effect.runSync(fake.send(parsed.args))));
          parsed = command(pending);
        }
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') return reject(new Error('no port'));
      resolve({
        fake,
        port: address.port,
        close: () =>
          new Promise((done) => {
            for (const peer of peers) peer.destroy();
            server.close(() => done());
          }),
      });
    });
  });
