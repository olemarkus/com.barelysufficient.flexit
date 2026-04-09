import sinon from 'sinon';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findStructuredLog } from './logging_test_utils';

class MockHomeyDriver {
  homey = { manifest: { version: '1.0.2' } };
  manifest = { id: 'nordic' };
  log = sinon.stub();
  error = sinon.stub();
  getDevices = sinon.stub().returns([]);
}

const nordicDriverMocks = vi.hoisted(() => ({
  discoverStub: undefined as any,
}));

vi.mock('homey', () => ({
  default: { Driver: MockHomeyDriver },
}));

vi.mock('../lib/flexitDiscovery', () => ({
  discoverFlexitUnits: (...args: any[]) => nordicDriverMocks.discoverStub(...args),
}));

describe('Nordic driver (vitest)', () => {
  let DriverClass: any;
  let discoverStub: sinon.SinonStub;

  beforeEach(async () => {
    vi.resetModules();
    discoverStub = sinon.stub();
    nordicDriverMocks.discoverStub = discoverStub;
    const mod = await import('../drivers/nordic/driver.ts');
    DriverClass = mod.default ?? mod;
  });

  it('logs app version during initialization', async () => {
    const driver = new DriverClass();

    await driver.onInit();

    const log = findStructuredLog(driver.log, 'driver.init');
    expect(log?.msg).toBe('Flexit Nordic BACnet driver initialized');
    expect(log?.appVersion).toBe('1.0.2');
  });

  it('falls back to the driver manifest version when the app manifest version is unavailable', async () => {
    const driver = new DriverClass();
    driver.homey = {};
    driver.manifest = { version: '0.9.0' };

    await driver.onInit();

    expect(findStructuredLog(driver.log, 'driver.init')?.appVersion).toBe('0.9.0');
  });

  it('falls back to unknown when no manifest version is available', async () => {
    const driver = new DriverClass();
    driver.homey = {};
    driver.manifest = {};

    await driver.onInit();

    expect(findStructuredLog(driver.log, 'driver.init')?.appVersion).toBe('unknown');
  });

  it('logs discovery progress and maps discovered units for pairing', async () => {
    discoverStub.resolves([
      {
        name: 'Nordic S4 REL',
        serialNormalized: '800131000001',
        ip: '192.0.2.10',
        bacnetPort: 47808,
        serial: '800131-000001',
        mac: '02:00:00:00:00:01',
      },
    ]);
    const driver = new DriverClass();

    const devices = await driver.onPairListDevices();
    const discoverArgs = discoverStub.firstCall.args[0];

    expect(discoverStub.calledOnce).toBe(true);
    expect(discoverArgs.timeoutMs).toBe(5000);
    expect(discoverArgs.burstCount).toBe(10);
    expect(discoverArgs.burstIntervalMs).toBe(300);
    expect(typeof discoverArgs.logger?.info).toBe('function');
    expect(typeof discoverArgs.logger?.error).toBe('function');
    const startLog = findStructuredLog(driver.log, 'driver.pair.discovery.start');
    expect(startLog?.timeoutMs).toBe(5000);
    const completeLog = findStructuredLog(driver.log, 'driver.pair.discovery.complete');
    expect(completeLog?.unitCount).toBe(1);
    expect(completeLog?.units).toEqual([
      {
        unitId: '800131000001',
        serial: '800131-000001',
        ip: '192.0.2.10',
        bacnetPort: 47808,
        status: 'new',
      },
    ]);
    expect(devices).toEqual([
      {
        name: 'Nordic S4 REL',
        data: {
          id: '800131000001',
          unitId: '800131000001',
        },
        settings: {
          ip: '192.0.2.10',
          bacnetPort: '47808',
          serial: '800131-000001',
          mac: '02:00:00:00:00:01',
        },
      },
    ]);
  });

  it('marks discovered units that are already paired', async () => {
    discoverStub.resolves([
      {
        name: 'Nordic S4 REL',
        serialNormalized: '800131000001',
        ip: '192.0.2.10',
        bacnetPort: 47808,
        serial: '800131-000001',
        mac: null,
      },
    ]);
    const driver = new DriverClass();
    driver.getDevices.returns([
      {
        getData: () => ({
          unitId: '800131000001',
        }),
      },
    ]);

    await driver.onPairListDevices();

    const completeLog = findStructuredLog(driver.log, 'driver.pair.discovery.complete');
    expect(completeLog?.units?.[0]?.status).toBe('already_added');
  });

  it('returns an empty pairing list without unit status logs when discovery finds nothing', async () => {
    discoverStub.resolves([]);
    const driver = new DriverClass();

    const devices = await driver.onPairListDevices();

    expect(devices).toEqual([]);
    const completeLog = findStructuredLog(driver.log, 'driver.pair.discovery.complete');
    expect(completeLog?.unitCount).toBe(0);
    expect(completeLog?.units).toEqual([]);
  });

  it('logs and rethrows discovery failures', async () => {
    const discoveryError = new Error('socket bind failed');
    discoverStub.rejects(discoveryError);
    const driver = new DriverClass();

    await expect(driver.onPairListDevices()).rejects.toThrow('socket bind failed');
    const failureLog = findStructuredLog(driver.error, 'driver.pair.discovery.failed');
    expect(failureLog?.msg).toBe('BACnet pairing discovery failed');
    expect(failureLog?.error?.message).toBe('socket bind failed');
  });
});
