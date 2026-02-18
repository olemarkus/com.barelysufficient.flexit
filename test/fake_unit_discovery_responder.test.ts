/* eslint-disable import/extensions */
import dgram from 'dgram';
import { expect } from 'chai';
import { createRequire } from 'module';

// eslint-disable-next-line import/extensions
import { sleep } from './test_utils.ts';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DiscoveryResponder } = require('../scripts/fake-unit/discoveryResponder.ts');

async function bindSocket(socket: dgram.Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', () => resolve());
  });
}

async function receiveMessage(socket: dgram.Socket, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for UDP message after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once('message', (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

describe('fake-unit discovery responder', () => {
  it('responds to discover packets with legacy/structured replies', async () => {
    const responder = new DiscoveryResponder({
      bindAddress: '127.0.0.1',
      advertiseAddress: '127.0.0.1',
      bacnetPort: 47888,
      serial: '800131-123456',
      deviceName: 'HvacFnct21y_A',
      firmware: '03.39.03.38',
      mac: '00:05:19:22:27:43',
      logTraffic: false,
    });

    const client = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    try {
      await responder.start();
      await bindSocket(client);

      const token = 'ABTMobile:11111111-2222-3333-4444-555555555555';
      const request = Buffer.from(`\0\0\0\0discover\0\0${token}`, 'ascii');
      client.send(request, 30000, '127.0.0.1');

      const first = await receiveMessage(client, 3000);
      const ascii = first.toString('latin1');
      expect(ascii.includes('identification') || ascii.includes('800131-123456')).to.equal(true);

      // Non-discover payload should not crash responder.
      client.send(Buffer.from('noise', 'ascii'), 30000, '127.0.0.1');
      await sleep(100);
    } finally {
      client.close();
      responder.stop();
    }
  });
});
