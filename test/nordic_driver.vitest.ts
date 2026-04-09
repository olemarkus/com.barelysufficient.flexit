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
});
