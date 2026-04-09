import sinon from 'sinon';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

    expect(driver.log.calledWith('Flexit Nordic driver init (app v1.0.2)')).toBe(true);
  });

  it('falls back to the driver manifest version when the app manifest version is unavailable', async () => {
    const driver = new DriverClass();
    driver.homey = {};
    driver.manifest = { version: '0.9.0' };

    await driver.onInit();

    expect(driver.log.calledWith('Flexit Nordic driver init (app v0.9.0)')).toBe(true);
  });

  it('falls back to unknown when no manifest version is available', async () => {
    const driver = new DriverClass();
    driver.homey = {};
    driver.manifest = {};

    await driver.onInit();

    expect(driver.log.calledWith('Flexit Nordic driver init (app vunknown)')).toBe(true);
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
    expect(typeof discoverArgs.log).toBe('function');
    expect(typeof discoverArgs.error).toBe('function');
    discoverArgs.log('[Discovery] test log');
    discoverArgs.error('[Discovery] test error');
    expect(driver.log.calledWithMatch('[Pair] Discovery start')).toBe(true);
    expect(driver.log.calledWithExactly('[Discovery] test log')).toBe(true);
    expect(driver.error.calledWithExactly('[Discovery] test error')).toBe(true);
    expect(driver.log.calledWithMatch('[Pair] Discovery complete: 1 unit(s) found in')).toBe(true);
    expect(driver.log.calledWithExactly('[Pair] Unit 800131-000001@192.0.2.10:47808 (new)')).toBe(true);
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

    expect(driver.log.calledWithExactly('[Pair] Unit 800131-000001@192.0.2.10:47808 (already added)')).toBe(true);
  });

  it('returns an empty pairing list without unit status logs when discovery finds nothing', async () => {
    discoverStub.resolves([]);
    const driver = new DriverClass();

    const devices = await driver.onPairListDevices();

    expect(devices).toEqual([]);
    expect(driver.log.calledWithMatch('[Pair] Discovery complete: 0 unit(s) found in')).toBe(true);
    expect(driver.log.getCalls().some((call) => String(call.args[0]).includes('[Pair] Unit '))).toBe(false);
  });

  it('logs and rethrows discovery failures', async () => {
    const discoveryError = new Error('socket bind failed');
    discoverStub.rejects(discoveryError);
    const driver = new DriverClass();

    await expect(driver.onPairListDevices()).rejects.toThrow('socket bind failed');
    expect(driver.error.calledOnce).toBe(true);
    expect(driver.error.firstCall.args[0]).toMatch(/^\[Pair\] Discovery failed after \d+ms:$/);
    expect(driver.error.firstCall.args[1]).toBe(discoveryError);
  });
});
