import sinon from 'sinon';
import os from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getFreePort, sleep } from './test_utils.ts';
import * as fakeUnit from '../scripts/fake-unit.ts';

async function importFakeUnitWithMocks(options: {
  networkInterfaces?: () => any;
  FakeNordicUnitState?: new (...args: any[]) => any;
  DiscoveryResponder?: new (...args: any[]) => any;
  FakeBacnetServer?: new (...args: any[]) => any;
  FakeApiServer?: new (...args: any[]) => any;
}) {
  vi.resetModules();
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof import('os')>('os');
    return {
      default: {
        ...actual.default,
        networkInterfaces: options.networkInterfaces ?? (() => ({})),
      },
      ...actual,
      networkInterfaces: options.networkInterfaces ?? (() => ({})),
    };
  });
  if (options.FakeNordicUnitState) {
    vi.doMock('../scripts/fake-unit/state.ts', () => ({
      FakeNordicUnitState: options.FakeNordicUnitState,
    }));
  }
  if (options.DiscoveryResponder) {
    vi.doMock('../scripts/fake-unit/discoveryResponder.ts', () => ({
      DiscoveryResponder: options.DiscoveryResponder,
    }));
  }
  if (options.FakeBacnetServer) {
    vi.doMock('../scripts/fake-unit/bacnetServer.ts', () => ({
      FakeBacnetServer: options.FakeBacnetServer,
    }));
  }
  if (options.FakeApiServer) {
    vi.doMock('../scripts/fake-unit/apiServer.ts', () => ({
      FakeApiServer: options.FakeApiServer,
    }));
  }

  return import('../scripts/fake-unit.ts');
}

describe('fake-unit runtime script (vitest)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('os');
    vi.doUnmock('../scripts/fake-unit/state.ts');
    vi.doUnmock('../scripts/fake-unit/discoveryResponder.ts');
    vi.doUnmock('../scripts/fake-unit/bacnetServer.ts');
    vi.doUnmock('../scripts/fake-unit/apiServer.ts');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('derives stable device IDs from serials', () => {
    const a = fakeUnit.deriveDeviceIdFromSerial('800131-123456');
    const b = fakeUnit.deriveDeviceIdFromSerial('800131123456');
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(999);
  });

  it('falls back to the minimum device id for invalid serials', () => {
    expect(fakeUnit.deriveDeviceIdFromSerial('invalid')).toBe(1000);
  });

  it('falls back when parseNumber receives invalid input', () => {
    expect(fakeUnit.parseNumber('invalid', 42)).toBe(42);
  });

  it('parses cli options', () => {
    const options = fakeUnit.parseArgs([
      '--bind', '127.0.0.1',
      '--advertise-ip', '127.0.0.1',
      '--api-port', '19000',
      '--bacnet-port', '47999',
      '--serial', '800131-999999',
      '--device-id', '1234',
      '--quiet',
    ]);

    expect(options.bindAddress).toBe('127.0.0.1');
    expect(options.advertiseAddress).toBe('127.0.0.1');
    expect(options.apiPort).toBe(19000);
    expect(options.bacnetPort).toBe(47999);
    expect(options.serial).toBe('800131-999999');
    expect(options.deviceId).toBe(1234);
    expect(options.logTraffic).toBe(false);
  });

  it('uses detected interface defaults when explicit values are omitted', () => {
    sinon.stub(os, 'networkInterfaces').returns({
      eth0: [{
        address: '192.0.2.20',
        netmask: '255.255.255.0',
        mac: '00:11:22:33:44:55',
        family: 'IPv4',
        internal: false,
        cidr: '192.0.2.20/24',
      } as any],
      lo: [{
        address: '127.0.0.1',
        netmask: '255.0.0.0',
        mac: '00:00:00:00:00:00',
        family: 'IPv4',
        internal: true,
        cidr: '127.0.0.1/8',
      } as any],
    } as any);

    const options = fakeUnit.parseArgs([]);

    expect(options.advertiseAddress).toBe('192.0.2.20');
    expect(options.networkMask).toBe('255.255.255.0');
    expect(options.mac).toBe('00:11:22:33:44:55');
    expect(options.deviceId).toBe(fakeUnit.deriveDeviceIdFromSerial(options.serial));
    expect(options.timeScale).toBe(1);
  });

  it('rejects missing values for value flags', () => {
    expect(() => fakeUnit.parseArgs(['--api-port', '--quiet']))
      .toThrow('Missing value for --api-port');
  });

  it('supports help mode without starting servers', async () => {
    const result = await fakeUnit.main(['--help']);
    expect(result).toBe(null);
  });

  it('respects explicit overrides for interface-derived defaults', () => {
    sinon.stub(os, 'networkInterfaces').returns({} as any);

    const options = fakeUnit.parseArgs([
      '--advertise-ip', '198.51.100.20',
      '--netmask', '255.255.0.0',
      '--mac', 'aa:bb:cc:dd:ee:ff',
      '--vendor-id', '42',
      '--time-scale', '120',
      '--periodic-iam-ms', '5000',
      '--tick-ms', '250',
    ]);

    expect(options.advertiseAddress).toBe('198.51.100.20');
    expect(options.networkMask).toBe('255.255.0.0');
    expect(options.mac).toBe('aa:bb:cc:dd:ee:ff');
    expect(options.vendorId).toBe(42);
    expect(options.timeScale).toBe(120);
    expect(options.periodicIAmMs).toBe(5000);
    expect(options.tickMs).toBe(250);
  });

  it('falls back to bind address and ignores positional argv entries in parseArgs', () => {
    sinon.stub(os, 'networkInterfaces').returns({} as any);

    const options = fakeUnit.parseArgs([
      'positional',
      '--bind', '198.51.100.40',
      '--quiet',
    ]);

    expect(options.bindAddress).toBe('198.51.100.40');
    expect(options.advertiseAddress).toBe('198.51.100.40');
    expect(options.logTraffic).toBe(false);
  });

  it('starts with signal handlers enabled and shutdown is idempotent', async () => {
    const discoveryStart = sinon.stub().resolves();
    const discoveryStop = sinon.stub();
    const bacnetStart = sinon.stub();
    const bacnetStop = sinon.stub();
    const apiStart = sinon.stub().resolves();
    const apiStop = sinon.stub();
    const tick = sinon.stub();
    const processOn = sinon.stub(process, 'on');
    const processOff = sinon.stub(process, 'off');
    const clock = sinon.useFakeTimers();
    const logStub = sinon.stub(console, 'log');

    let stateOptions: any;
    let discoveryOptions: any;

    class MockState {
      tick = tick;

      constructor(options: any) {
        stateOptions = options;
      }

      getIdentity() {
        return {
          serial: '800131-654321',
          deviceId: 4242,
          modelName: 'Mock Nordic',
        };
      }
    }

    class MockDiscoveryResponder {
      start = discoveryStart;
      stop = discoveryStop;

      constructor(options: any) {
        discoveryOptions = options;
      }
    }

    class MockBacnetServer {
      start = bacnetStart;
      stop = bacnetStop;
    }

    class MockApiServer {
      start = apiStart;
      stop = apiStop;
    }

    const runtimeModule = await importFakeUnitWithMocks({
      networkInterfaces: () => ({}),
      FakeNordicUnitState: MockState as any,
      DiscoveryResponder: MockDiscoveryResponder as any,
      FakeBacnetServer: MockBacnetServer as any,
      FakeApiServer: MockApiServer as any,
    });

    try {
      const runtime = await runtimeModule.startFakeUnit({
        apiHost: '127.0.0.1',
        apiPort: 18080,
        bacnetPort: 47808,
        bindAddress: undefined,
        advertiseAddress: undefined,
        logTraffic: true,
        serial: '800131-654321',
        deviceId: 4242,
        deviceName: 'Mock Device',
        modelName: 'Mock Nordic',
        firmware: '1.2.3',
        mac: 'aa:bb:cc:dd:ee:ff',
        vendorName: 'Flexit',
        vendorId: 783,
        timeScale: 30,
        periodicIAmMs: 0,
        tickMs: 1000,
      }, true);

      expect(stateOptions.identity.deviceId).toBe(4242);
      expect(discoveryOptions.advertiseAddress).toBe('127.0.0.1');
      expect(processOn.calledWith('SIGINT')).toBe(true);
      expect(processOn.calledWith('SIGTERM')).toBe(true);

      clock.tick(1000);
      expect(tick.called).toBe(true);

      runtime.shutdown();
      runtime.shutdown();

      expect(processOff.calledWith('SIGINT')).toBe(true);
      expect(processOff.calledWith('SIGTERM')).toBe(true);
      expect(discoveryStop.calledOnce).toBe(true);
      expect(bacnetStop.calledOnce).toBe(true);
      expect(apiStop.calledOnce).toBe(true);
      expect(logStub.calledWithMatch('[FakeUnit] BACnet listening on 0.0.0.0:47808')).toBe(true);
    } finally {
      logStub.restore();
      clock.restore();
    }
  });

  it('starts via main() when help flags are absent', async () => {
    const fakeRuntime = { shutdown: sinon.stub() };

    class MockState {
      tick = () => undefined;

      getIdentity() {
        return { serial: '800131-654321', deviceId: 42, modelName: 'Mock' };
      }
    }

    class MockDiscoveryResponder {
      start = () => Promise.resolve();
      stop = () => undefined;
    }

    class MockBacnetServer {
      start = () => undefined;
      stop = () => undefined;
    }

    class MockApiServer {
      start = () => Promise.resolve();
      stop = () => undefined;
    }

    const runtimeModule = await importFakeUnitWithMocks({
      networkInterfaces: () => ({}),
      FakeNordicUnitState: MockState as any,
      DiscoveryResponder: MockDiscoveryResponder as any,
      FakeBacnetServer: MockBacnetServer as any,
      FakeApiServer: MockApiServer as any,
    });

    const runtime = await runtimeModule.main(['--quiet']);
    expect(runtime).toEqual(expect.any(Object));
    (runtime ?? fakeRuntime).shutdown();
  });

  it('starts and stops full fake-unit runtime', async () => {
    const apiPort = await getFreePort();
    const bacnetPort = await getFreePort();
    const options = fakeUnit.parseArgs([
      '--bind', '127.0.0.1',
      '--advertise-ip', '127.0.0.1',
      '--api-port', String(apiPort),
      '--bacnet-port', String(bacnetPort),
      '--quiet',
      '--periodic-iam-ms', '0',
      '--tick-ms', '50',
    ]);

    const runtime = await fakeUnit.startFakeUnit(options, false);
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/health`);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.ok).toBe(true);
    } finally {
      runtime.shutdown();
      await sleep(50);
    }
  });
});
