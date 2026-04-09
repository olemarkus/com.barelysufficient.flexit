import { EventEmitter } from 'events';
import sinon from 'sinon';
import { afterEach, describe, expect, it } from 'vitest';
import { findStructuredLog } from './logging_test_utils';
import {
  discoverFlexitUnits,
  listIPv4Interfaces,
  resetFlexitDiscoveryDependenciesForTests,
  setFlexitDiscoveryDependenciesForTests,
} from '../lib/flexitDiscovery';

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

function installDiscoveryDependencies(options?: {
  networkInterfaces?: Record<string, Array<Record<string, any>> | undefined>;
  createSocket?: sinon.SinonStub;
  parseFlexitReply?: sinon.SinonStub;
}) {
  setFlexitDiscoveryDependenciesForTests({
    networkInterfaces: sinon.stub().returns(options?.networkInterfaces ?? {}),
    createSocket: options?.createSocket ?? sinon.stub(),
    randomUUID: sinon.stub().returns('11111111-2222-3333-4444-555555555555'),
    parseFlexitReply: options?.parseFlexitReply ?? sinon.stub().returns(null),
  });
}

describe('flexitDiscovery (vitest)', () => {
  afterEach(() => {
    sinon.restore();
    resetFlexitDiscoveryDependenciesForTests();
  });

  it('lists only external IPv4 interfaces', () => {
    installDiscoveryDependencies({
      networkInterfaces: {
        eth0: [
          { family: 'IPv4', internal: false, address: '192.0.2.10' },
          { family: 'IPv4', internal: true, address: '127.0.0.1' },
          { family: 'IPv6', internal: false, address: '2001:db8::10' },
        ],
        wlan0: undefined,
      },
    });

    expect(listIPv4Interfaces()).toEqual([
      { name: 'eth0', address: '192.0.2.10' },
    ]);
  });

  it('returns no discovered units when the requested interface is unavailable', async () => {
    const createSocket = sinon.stub();
    const log = sinon.stub();
    const error = sinon.stub();
    installDiscoveryDependencies({
      networkInterfaces: {
        eth0: [{ family: 'IPv4', internal: false, address: '192.0.2.10' }],
      },
      createSocket,
    });

    const units = await discoverFlexitUnits({
      interfaceAddress: '198.51.100.9',
      timeoutMs: 0,
      log,
      error,
    });

    expect(units).toEqual([]);
    expect(createSocket.called).toBe(false);
    const selectionLog = findStructuredLog(log, 'discovery.interfaces.selected');
    expect(selectionLog?.availableInterfaces).toEqual(['eth0=192.0.2.10']);
    expect(selectionLog?.requestedInterfaceAddress).toBe('198.51.100.9');
    expect(selectionLog?.selectedInterfaces).toEqual([]);
    expect(findStructuredLog(log, 'discovery.interfaces.none_selected')?.interfaceAddress).toBe('198.51.100.9');
  });

  it('keeps structured discovery logging enabled when only a log callback is provided', async () => {
    const createSocket = sinon.stub();
    const log = sinon.stub();
    installDiscoveryDependencies({
      networkInterfaces: {
        eth0: [{ family: 'IPv4', internal: false, address: '192.0.2.10' }],
      },
      createSocket,
    });

    const units = await discoverFlexitUnits({
      interfaceAddress: '198.51.100.9',
      timeoutMs: 0,
      log,
    });

    expect(units).toEqual([]);
    expect(createSocket.called).toBe(false);
    expect(findStructuredLog(log, 'discovery.interfaces.none_selected')?.interfaceAddress).toBe('198.51.100.9');
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
      expect(Buffer.isBuffer(payload)).toBe(true);
      expect(payload.length).toBe(104);
      expect(payload.toString('ascii')).toContain('discover');
      expect(port).toBe(30000);
      expect(group).toBe('224.0.0.180');

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

    installDiscoveryDependencies({
      networkInterfaces: {
        eth0: [{ family: 'IPv4', internal: false, address: '192.0.2.10' }],
        eth1: [{ family: 'IPv4', internal: false, address: '192.0.2.11' }],
      },
      createSocket,
      parseFlexitReply,
    });

    const units = await discoverFlexitUnits({
      interfaceAddress: 'auto',
      timeoutMs: 0,
      burstCount: 1,
      burstIntervalMs: 0,
      log,
      error,
    });

    expect(units).toEqual([
      parsedUnits.get('198.51.100.20'),
      parsedUnits.get('198.51.100.21'),
    ]);
    expect(rxSocket.addMembership.firstCall.args).toEqual(['224.0.0.181', '192.0.2.10']);
    expect(rxSocket.addMembership.secondCall.args).toEqual(['224.0.0.181', '192.0.2.11']);
    expect(txSocket.setMulticastTTL.calledOnceWithExactly(1)).toBe(true);
    expect(txSocket.setMulticastLoopback.calledOnceWithExactly(false)).toBe(true);
    expect(txSocket.setMulticastInterface.calledTwice).toBe(true);
    expect(txSocket.send.calledOnce).toBe(true);
    expect(rxSocket.close.calledOnce).toBe(true);
    expect(txSocket.close.calledOnce).toBe(true);
    const selectionLog = findStructuredLog(log, 'discovery.interfaces.selected');
    expect(selectionLog?.availableInterfaces).toEqual(['eth0=192.0.2.10', 'eth1=192.0.2.11']);
    expect(selectionLog?.selectedInterfaces).toEqual(['eth0=192.0.2.10', 'eth1=192.0.2.11']);
  });
});
