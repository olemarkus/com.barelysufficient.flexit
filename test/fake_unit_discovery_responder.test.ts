/* eslint-disable import/extensions */
import dgram from 'dgram';
import { expect } from 'chai';
import { EventEmitter } from 'events';
import { createRequire } from 'module';
import sinon from 'sinon';

// eslint-disable-next-line import/extensions
import { sleep } from './test_utils.ts';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const proxyquire = require('proxyquire');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DiscoveryResponder } = require('../scripts/fake-unit/discoveryResponder.ts');

const proxyquireStrict = proxyquire.noCallThru().noPreserveCache();

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
  afterEach(() => {
    sinon.restore();
  });

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

  it('logs unique external replies and skips self-originated replies', () => {
    const logStub = sinon.stub(console, 'log');
    const responder = new DiscoveryResponder({
      bindAddress: '192.0.2.10',
      advertiseAddress: '198.51.100.20',
      bacnetPort: 47888,
      serial: '800131-123456',
      deviceName: 'HvacFnct21y_A',
      firmware: '03.39.03.38',
      mac: '00:05:19:22:27:43',
      logTraffic: true,
    }) as any;

    expect(responder.isSelfAddress('127.0.0.1')).to.equal(true);
    expect(responder.isSelfAddress('192.0.2.10')).to.equal(true);
    expect(responder.isSelfAddress('198.51.100.20')).to.equal(true);
    expect(responder.isSelfAddress('203.0.113.5')).to.equal(false);

    responder.logObservedExternalReply(
      Buffer.from('reply 800131123456 payload', 'ascii'),
      { address: '127.0.0.1', port: 30001 },
    );
    expect(logStub.called).to.equal(false);

    responder.logObservedExternalReply(
      Buffer.from('reply 800131123456 payload', 'ascii'),
      { address: '203.0.113.5', port: 30001 },
    );
    expect(logStub.called).to.equal(true);
    const firstLogCount = logStub.callCount;

    responder.logObservedExternalReply(
      Buffer.from('reply 800131123456 payload', 'ascii'),
      { address: '203.0.113.5', port: 30001 },
    );
    expect(logStub.callCount).to.equal(firstLogCount);

    responder.logObservedExternalReply(
      Buffer.from('opaque bytes only', 'ascii'),
      { address: '203.0.113.6', port: 30001 },
    );
    expect(logStub.callCount).to.be.greaterThan(firstLogCount);
  });

  it('suppresses logs when traffic logging is disabled and stop() is idempotent', () => {
    const logStub = sinon.stub(console, 'log');
    const responder = new DiscoveryResponder({
      advertiseAddress: '198.51.100.20',
      bacnetPort: 47888,
      serial: '800131-123456',
      deviceName: 'HvacFnct21y_A',
      firmware: '03.39.03.38',
      mac: '00:05:19:22:27:43',
      logTraffic: false,
    }) as any;

    responder.log('hidden');
    responder.stop();
    responder.stop();

    expect(logStub.called).to.equal(false);
  });

  it('starts mocked sockets, replies to discovery, and logs multicast setup failures', async () => {
    const errorStub = sinon.stub(console, 'error');

    const createSocket = (membershipFails = false, interfaceFails = false) => {
      const socket = new EventEmitter() as EventEmitter & Record<string, any>;
      socket.bind = (_port: number, _bindAddress: string | undefined, callback: () => void) => callback();
      socket.addMembership = sinon.stub().callsFake(() => {
        if (membershipFails) throw new Error('membership failed');
      });
      socket.setMulticastTTL = sinon.stub();
      socket.setMulticastLoopback = sinon.stub();
      socket.setMulticastInterface = sinon.stub().callsFake(() => {
        if (interfaceFails) throw new Error('interface failed');
      });
      socket.send = sinon.stub();
      socket.close = sinon.stub();
      socket.off = sinon.stub().callsFake((event: string, handler: (...args: any[]) => void) => {
        EventEmitter.prototype.off.call(socket, event, handler);
        return socket;
      });
      return socket;
    };

    const firstRx = createSocket();
    const firstTx = createSocket();
    const secondRx = createSocket(true, true);
    const secondTx = createSocket(true, false);
    const dgramStub = {
      createSocket: sinon.stub()
        .onCall(0)
        .returns(firstRx)
        .onCall(1)
        .returns(firstTx)
        .onCall(2)
        .returns(secondRx)
        .onCall(3)
        .returns(secondTx),
    };

    const { DiscoveryResponder: MockedResponder } = proxyquireStrict('../scripts/fake-unit/discoveryResponder.ts', {
      dgram: dgramStub,
    });

    const responder = new MockedResponder({
      bindAddress: '127.0.0.1',
      advertiseAddress: '127.0.0.1',
      bacnetPort: 47888,
      serial: '800131-123456',
      deviceName: 'HvacFnct21y_A',
      firmware: '03.39.03.38',
      mac: '00:05:19:22:27:43',
      logTraffic: false,
    });

    await responder.start();
    await responder.start();

    expect(firstRx.addMembership.calledWith('224.0.0.180', '127.0.0.1')).to.equal(true);
    expect(firstTx.addMembership.calledWith('224.0.0.181', '127.0.0.1')).to.equal(true);

    firstRx.emit('message', Buffer.from('noise', 'ascii'), {
      address: '192.0.2.10',
      family: 'IPv4',
      port: 30001,
      size: 5,
    });
    expect(firstRx.send.called).to.equal(false);

    firstRx.emit('message', Buffer.from('\0\0\0\0discover\0\0token', 'ascii'), {
      address: '192.0.2.10',
      family: 'IPv4',
      port: 30001,
      size: 18,
    });
    expect(firstRx.send.callCount).to.equal(3);

    responder.stop();
    expect(firstRx.close.calledOnce).to.equal(true);
    expect(firstTx.close.calledOnce).to.equal(true);

    const responderWithoutBind = new MockedResponder({
      advertiseAddress: '198.51.100.20',
      bacnetPort: 47888,
      serial: '800131-123456',
      deviceName: 'HvacFnct21y_A',
      firmware: '03.39.03.38',
      mac: '00:05:19:22:27:43',
      logTraffic: false,
    });
    await responderWithoutBind.start();
    expect(secondRx.addMembership.calledWith('224.0.0.180')).to.equal(true);
    expect(secondTx.addMembership.calledWith('224.0.0.181')).to.equal(true);
    expect(errorStub.called).to.equal(true);
  });
});
