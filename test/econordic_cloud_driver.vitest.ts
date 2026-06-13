import sinon from 'sinon';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findStructuredLog } from './logging_test_utils';

class MockHomeyDriver {
  homey = { manifest: { version: '1.0.0' } };
  manifest = { id: 'econordic-cloud' };
  log = sinon.stub();
  error = sinon.stub();
}

function createSession() {
  const handlers = new Map<string, any>();
  return {
    handlers,
    setHandler: sinon.stub().callsFake((name: string, handler: any) => {
      handlers.set(name, handler);
    }),
  };
}

const econordicCloudDriverMocks = vi.hoisted(() => ({
  clients: [] as any[],
  registryStub: {} as Record<string, any>,
}));

vi.mock('homey', () => ({
  default: { Driver: MockHomeyDriver },
}));

vi.mock('../lib/flexitCloudClient', () => ({
  FlexitCloudClient: function MockedFlexitCloudClient(this: any) {
    return econordicCloudDriverMocks.clients.shift();
  },
}));

vi.mock('../lib/UnitRegistry', () => ({
  Registry: econordicCloudDriverMocks.registryStub,
}));

describe('EcoNordic cloud driver (vitest)', () => {
  let DriverClass: any;

  beforeEach(async () => {
    vi.resetModules();
    econordicCloudDriverMocks.clients = [];
    const mod = await import('../drivers/econordic-cloud/driver.ts');
    DriverClass = mod.default ?? mod;
  });

  it('initializes with the EcoNordic cloud driver label', async () => {
    const driver = new DriverClass();

    await driver.onInit();

    expect(findStructuredLog(driver.log, 'driver.init')?.msg).toBe('Flexit EcoNordic cloud driver initialized');
  });

  it('excludes Nordic plants from the EcoNordic cloud pairing list', async () => {
    const token = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 86_400_000,
    };
    econordicCloudDriverMocks.clients = [
      { authenticateWithPassword: sinon.stub().resolves(token) },
      {
        restoreToken: sinon.stub(),
        findPlants: sinon.stub().resolves([
          { id: 'plant-1', name: 'Nordic', serialNumber: '800131-000001' },
        ]),
      },
    ];
    vi.resetModules();
    const mod = await import('../drivers/econordic-cloud/driver.ts');
    DriverClass = mod.default ?? mod;

    const driver = new DriverClass();
    const session = createSession();
    await driver.onPair(session);
    await session.handlers.get('login')({ username: 'user@example.com', password: 'secret' });
    const devices = await session.handlers.get('list_devices')();

    expect(devices).toEqual([]);
    const listedLog = findStructuredLog(driver.log, 'driver.pair.devices.listed');
    expect(listedLog?.plantCount).toBe(1);
    expect(listedLog?.matchedCount).toBe(0);
  });
});
