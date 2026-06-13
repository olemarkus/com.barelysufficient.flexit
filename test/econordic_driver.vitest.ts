import sinon from 'sinon';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findStructuredLog } from './logging_test_utils';

class MockHomeyDriver {
  homey = { manifest: { version: '1.0.0' } };
  manifest = { id: 'econordic' };
  log = sinon.stub();
  error = sinon.stub();
  getDevices = sinon.stub().returns([]);
}

const econordicDriverMocks = vi.hoisted(() => ({
  discoverStub: undefined as any,
}));

vi.mock('homey', () => ({
  default: { Driver: MockHomeyDriver },
}));

vi.mock('../lib/flexitDiscovery', () => ({
  discoverFlexitUnits: (...args: any[]) => econordicDriverMocks.discoverStub(...args),
}));

describe('EcoNordic local driver (vitest)', () => {
  let DriverClass: any;
  let discoverStub: sinon.SinonStub;

  beforeEach(async () => {
    vi.resetModules();
    discoverStub = sinon.stub();
    econordicDriverMocks.discoverStub = discoverStub;
    const mod = await import('../drivers/econordic/driver.ts');
    DriverClass = mod.default ?? mod;
  });

  it('initializes with the EcoNordic BACnet driver label', async () => {
    const driver = new DriverClass();

    await driver.onInit();

    expect(findStructuredLog(driver.log, 'driver.init')?.msg).toBe('Flexit EcoNordic BACnet driver initialized');
  });

  it('lists only EcoNordic-series units and excludes Nordic units', async () => {
    discoverStub.resolves([
      {
        name: 'Nordic S4 REL',
        series: 'nordic',
        serialNormalized: '800131000001',
        ip: '192.0.2.10',
        bacnetPort: 47808,
        serial: '800131-000001',
        mac: '',
      },
      {
        name: 'EcoNordic WH4',
        series: 'econordic',
        serialNormalized: '900501000001',
        ip: '192.0.2.20',
        bacnetPort: 47808,
        serial: '900501-000001',
        mac: '',
      },
    ]);
    const driver = new DriverClass();

    const devices = await driver.onPairListDevices();

    expect(devices).toHaveLength(1);
    expect(devices[0].data.unitId).toBe('900501000001');
    const completeLog = findStructuredLog(driver.log, 'driver.pair.discovery.complete');
    expect(completeLog?.unitCount).toBe(2);
    expect(completeLog?.matchedCount).toBe(1);
  });
});
