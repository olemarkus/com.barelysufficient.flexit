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
    const log = sinon.stub();
    const flexitDiscovery = loadDiscoveryModule({
      networkInterfaces: {
        eth0: [{ family: 'IPv4', internal: false, address: '192.0.2.10' }],
      },
      createSocket,
    });

    const units = await flexitDiscovery.discoverFlexitUnits({
      interfaceAddress: '198.51.100.9',
      timeoutMs: 0,
      log,
    });

    expect(units).to.deep.equal([]);
    expect(createSocket.called).to.equal(false);
    expect(log.calledWithExactly('[Discovery] Available IPv4 interfaces: eth0=192.0.2.10')).to.equal(true);
    expect(log.calledWithExactly('[Discovery] Requested interface address: 198.51.100.9')).to.equal(true);
    expect(log.calledWithExactly('[Discovery] Selected interfaces: none')).to.equal(true);
    expect(log.calledWithExactly('[Discovery] No candidate interfaces available for discovery')).to.equal(true);
  });

  it('logs interface selection, reply parsing, and per-interface failures while discovering', async () => {
    const rxSocket = createMockSocket();
    const txSocket = createMockSocket();
    txSocket.close = sinon.stub().throws(new Error('close failed'));
    const log = sinon.stub();
    const error = sinon.stub();

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
      rxSocket.emit('message', Buffer.from('unparsed-reply', 'ascii'), { address: '198.51.100.99', port: 30001 });
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
      log,
      error,
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

    const availableInterfacesLog = '[Discovery] Available IPv4 interfaces: eth0=192.0.2.10, eth1=192.0.2.11';
    const selectedInterfacesLog = '[Discovery] Selected interfaces: eth0=192.0.2.10, eth1=192.0.2.11';
    const joinedReplyLog = '[Discovery] Joined reply multicast 224.0.0.181 on eth0=192.0.2.10';
    const discoveryTargetLog = '[Discovery] Discovery request target 224.0.0.180:30000 (multicast loopback disabled)';
    const sendSuccessLog = '[Discovery] Sending discover via eth0=192.0.2.10 to 224.0.0.180:30000';
    const parsedReplyOneLog = '[Discovery] Parsed reply from 198.51.100.20:? len=9: 800131-000001@198.51.100.20:47808';
    const parsedReplyDuplicateLog = '[Discovery] Parsed reply from 198.51.100.20:? len=19:'
      + ' 800131-000001@198.51.100.20:47808 (duplicate)';
    const parsedReplyTwoLog = '[Discovery] Parsed reply from 198.51.100.21:? len=9: 800131-000002@198.51.100.21:47808';
    const ignoredReplyLog = '[Discovery] Ignored reply from 198.51.100.99:30001 len=14;'
      + ' parser returned null; ascii="unparsed-reply"';

    expect(log.calledWithExactly(availableInterfacesLog)).to.equal(true);
    expect(log.calledWithExactly(selectedInterfacesLog)).to.equal(true);
    expect(log.calledWithExactly('[Discovery] Bound RX socket on 0.0.0.0:30001')).to.equal(true);
    expect(log.calledWithExactly(joinedReplyLog)).to.equal(true);
    expect(error.calledWithExactly(
      '[Discovery] Failed to join reply multicast 224.0.0.181 on eth1=192.0.2.11:',
      sinon.match.instanceOf(Error),
    )).to.equal(true);
    expect(log.calledWithExactly('[Discovery] Bound TX socket on 0.0.0.0:30000')).to.equal(true);
    expect(log.calledWithExactly(discoveryTargetLog)).to.equal(true);
    expect(log.calledWithExactly(sendSuccessLog)).to.equal(true);
    expect(error.calledWithExactly(
      '[Discovery] Failed to send discover via eth1=192.0.2.11 to 224.0.0.180:30000:',
      sinon.match.instanceOf(Error),
    )).to.equal(true);
    expect(log.calledWithExactly(parsedReplyOneLog)).to.equal(true);
    expect(log.calledWithExactly(parsedReplyDuplicateLog)).to.equal(true);
    expect(log.calledWithExactly(parsedReplyTwoLog)).to.equal(true);
    expect(log.calledWithExactly(ignoredReplyLog)).to.equal(true);
  });
});
