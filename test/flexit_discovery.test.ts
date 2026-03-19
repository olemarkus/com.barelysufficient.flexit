import { expect } from 'chai';
import { EventEmitter } from 'events';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

const proxyquireStrict = proxyquire.noCallThru().noPreserveCache();

function createMockSocket() {
  const socket = new EventEmitter() as EventEmitter & Record<string, any>;
  socket.bind = sinon.stub().callsFake((_port: number, callback: () => void) => callback());
  socket.addMembership = sinon.stub();
  socket.setMulticastTTL = sinon.stub();
  socket.setMulticastLoopback = sinon.stub();
  socket.setMulticastInterface = sinon.stub();
  socket.send = sinon.stub();
  socket.close = sinon.stub();
  return socket;
}

function loadDiscoveryModule(options?: {
  networkInterfaces?: Record<string, Array<Record<string, any>> | undefined>;
  createSocket?: sinon.SinonStub;
  parseFlexitReply?: sinon.SinonStub;
}) {
  return proxyquireStrict('../lib/flexitDiscovery', {
    os: {
      networkInterfaces: sinon.stub().returns(options?.networkInterfaces ?? {}),
    },
    dgram: {
      createSocket: options?.createSocket ?? sinon.stub(),
    },
    crypto: {
      randomUUID: sinon.stub().returns('11111111-2222-3333-4444-555555555555'),
    },
    './flexitReplyParser': {
      parseFlexitReply: options?.parseFlexitReply ?? sinon.stub().returns(null),
    },
  });
}

describe('flexitDiscovery', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('lists only external IPv4 interfaces', () => {
    const flexitDiscovery = loadDiscoveryModule({
      networkInterfaces: {
        eth0: [
          { family: 'IPv4', internal: false, address: '192.0.2.10' },
          { family: 'IPv4', internal: true, address: '127.0.0.1' },
          { family: 'IPv6', internal: false, address: '2001:db8::10' },
        ],
        wlan0: undefined,
      },
    });

    expect(flexitDiscovery.listIPv4Interfaces()).to.deep.equal([
      { name: 'eth0', address: '192.0.2.10' },
    ]);
  });

  it('returns no discovered units when the requested interface is unavailable', async () => {
    const createSocket = sinon.stub();
    const flexitDiscovery = loadDiscoveryModule({
      networkInterfaces: {
        eth0: [{ family: 'IPv4', internal: false, address: '192.0.2.10' }],
      },
      createSocket,
    });

    const units = await flexitDiscovery.discoverFlexitUnits({
      interfaceAddress: '198.51.100.9',
      timeoutMs: 0,
    });

    expect(units).to.deep.equal([]);
    expect(createSocket.called).to.equal(false);
  });

  it('discovers unique replies, ignores per-interface multicast failures, and always closes sockets', async () => {
    const rxSocket = createMockSocket();
    const txSocket = createMockSocket();
    txSocket.close = sinon.stub().throws(new Error('close failed'));

    rxSocket.addMembership.callsFake((_group: string, address?: string) => {
      if (address === '192.0.2.11') {
        throw new Error('membership failed');
      }
    });
    txSocket.setMulticastInterface.callsFake((address: string) => {
      if (address === '192.0.2.11') {
        throw new Error('interface failed');
      }
    });

    const parsedUnits = new Map([
      ['198.51.100.20', {
        name: 'Flexit A',
        model: 'S4',
        serial: '800131-000001',
        serialNormalized: '800131000001',
        ip: '198.51.100.20',
        bacnetPort: 47808,
        mac: '00:11:22:33:44:55',
        fw: undefined,
      }],
      ['198.51.100.21', {
        name: 'Flexit B',
        model: 'S6',
        serial: '800131-000002',
        serialNormalized: '800131000002',
        ip: '198.51.100.21',
        bacnetPort: 47808,
        mac: '00:11:22:33:44:56',
        fw: undefined,
      }],
    ]);

    txSocket.send.callsFake((payload: Buffer, port: number, group: string) => {
      expect(Buffer.isBuffer(payload)).to.equal(true);
      expect(payload.length).to.equal(104);
      expect(payload.toString('ascii')).to.include('discover');
      expect(port).to.equal(30000);
      expect(group).to.equal('224.0.0.180');

      rxSocket.emit('message', Buffer.from('reply-one', 'ascii'), { address: '198.51.100.20' });
      rxSocket.emit('message', Buffer.from('reply-one-duplicate', 'ascii'), { address: '198.51.100.20' });
      rxSocket.emit('message', Buffer.from('reply-two', 'ascii'), { address: '198.51.100.21' });
    });

    const createSocket = sinon.stub()
      .onFirstCall()
      .returns(rxSocket)
      .onSecondCall()
      .returns(txSocket);
    const parseFlexitReply = sinon.stub().callsFake((_message: Buffer, address: string) => (
      parsedUnits.get(address) ?? null
    ));
    const flexitDiscovery = loadDiscoveryModule({
      networkInterfaces: {
        eth0: [{ family: 'IPv4', internal: false, address: '192.0.2.10' }],
        eth1: [{ family: 'IPv4', internal: false, address: '192.0.2.11' }],
      },
      createSocket,
      parseFlexitReply,
    });

    const units = await flexitDiscovery.discoverFlexitUnits({
      interfaceAddress: 'auto',
      timeoutMs: 0,
      burstCount: 1,
      burstIntervalMs: 0,
    });

    expect(units).to.deep.equal([
      parsedUnits.get('198.51.100.20'),
      parsedUnits.get('198.51.100.21'),
    ]);
    expect(rxSocket.addMembership.firstCall.args).to.deep.equal(['224.0.0.181', '192.0.2.10']);
    expect(rxSocket.addMembership.secondCall.args).to.deep.equal(['224.0.0.181', '192.0.2.11']);
    expect(txSocket.setMulticastTTL.calledOnceWithExactly(1)).to.equal(true);
    expect(txSocket.setMulticastLoopback.calledOnceWithExactly(false)).to.equal(true);
    expect(txSocket.setMulticastInterface.calledTwice).to.equal(true);
    expect(txSocket.send.calledOnce).to.equal(true);
    expect(rxSocket.close.calledOnce).to.equal(true);
    expect(txSocket.close.calledOnce).to.equal(true);
  });
});
