import sinon from 'sinon';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockHomeyDriver {
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

async function flushMicrotasks() {
  await Promise.resolve();
}

const nordicCloudDriverMocks = vi.hoisted(() => ({
  clients: [] as any[],
  registryStub: {} as Record<string, any>,
}));

vi.mock('homey', () => ({
  default: { Driver: MockHomeyDriver },
}));

vi.mock('../lib/flexitCloudClient', () => ({
  FlexitCloudClient: function MockedFlexitCloudClient(this: any) {
    return nordicCloudDriverMocks.clients.shift();
  },
}));

vi.mock('../lib/UnitRegistry', () => ({
  Registry: nordicCloudDriverMocks.registryStub,
}));

function setCloudDriverMocks(options?: {
  clients?: any[];
  registry?: Record<string, any>;
}) {
  nordicCloudDriverMocks.clients = [...(options?.clients ?? [])];
  for (const key of Object.keys(nordicCloudDriverMocks.registryStub)) {
    delete nordicCloudDriverMocks.registryStub[key];
  }
  Object.assign(nordicCloudDriverMocks.registryStub, {
    hasCloudUnit: sinon.stub().returns(false),
    restoreCloudAuth: sinon.stub(),
    registerCloud: sinon.stub(),
    ...(options?.registry ?? {}),
  });
}

describe('Nordic cloud driver (vitest)', () => {
  let DriverClass: any;

  beforeEach(async () => {
    vi.resetModules();
    setCloudDriverMocks();
    const mod = await import('../drivers/nordic-cloud/driver.ts');
    DriverClass = mod.default ?? mod;
  });

  it('logs app version during initialization', async () => {
    const driver = new DriverClass();
    driver.homey = { manifest: { version: '1.2.3' } };
    driver.manifest = { version: '0.9.0' };

    await driver.onInit();

    expect(driver.log.calledOnceWithExactly('Flexit Nordic Cloud driver init (app v1.2.3)')).toBe(true);
  });

  it('falls back to the driver manifest version or unknown during initialization', async () => {
    const manifestDriver = new DriverClass();
    manifestDriver.homey = {};
    manifestDriver.manifest = { version: '0.9.0' };

    await manifestDriver.onInit();

    expect(manifestDriver.log.calledWithExactly('Flexit Nordic Cloud driver init (app v0.9.0)')).toBe(true);

    const unknownDriver = new DriverClass();
    unknownDriver.homey = {};
    unknownDriver.manifest = {};

    await unknownDriver.onInit();

    expect(unknownDriver.log.calledWithExactly('Flexit Nordic Cloud driver init (app vunknown)')).toBe(true);
  });

  it('requires a successful cloud login before listing paired devices', async () => {
    const driver = new DriverClass();
    const session = createSession();

    await driver.onPair(session);
    const listDevicesHandler = session.handlers.get('list_devices');

    let error: unknown;
    try {
      await listDevicesHandler();
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Not authenticated. Please log in first.');
  });

  it('authenticates during pairing and maps cloud plants to devices with persisted tokens', async () => {
    const pairedToken = {
      accessToken: 'paired-access-token',
      refreshToken: 'paired-refresh-token',
      expiresAt: Date.now() + 86_400_000,
    };
    const authClient = {
      authenticateWithPassword: sinon.stub().resolves(pairedToken),
    };
    const listClient = {
      restoreToken: sinon.stub(),
      findPlants: sinon.stub().resolves([
        { id: 'plant-1', name: 'Living Room', serialNumber: '800131-000001' },
        { id: 'plant-2', name: '', serialNumber: '800131-000002' },
      ]),
    };
    setCloudDriverMocks({
      clients: [authClient, listClient],
    });
    vi.resetModules();
    const mod = await import('../drivers/nordic-cloud/driver.ts');
    DriverClass = mod.default ?? mod;

    const driver = new DriverClass();
    const session = createSession();
    await driver.onPair(session);
    const loginHandler = session.handlers.get('login');
    const listDevicesHandler = session.handlers.get('list_devices');

    const loginResult = await loginHandler({
      username: 'user@example.com',
      password: 'secret',
    });
    const devices = await listDevicesHandler();

    expect(loginResult).toBe(true);
    expect(listClient.restoreToken.calledOnceWithExactly(pairedToken)).toBe(true);
    expect(driver.log.calledOnceWithExactly('[Pair] Found 2 plant(s) in Flexit cloud')).toBe(true);
    expect(devices).toEqual([
      {
        name: 'Living Room',
        data: {
          id: 'plant-1',
          unitId: 'plant-1',
          plantId: 'plant-1',
        },
        settings: {
          plantId: 'plant-1',
        },
        store: {
          cloudAccessToken: pairedToken.accessToken,
          cloudRefreshToken: pairedToken.refreshToken,
          cloudTokenExpiresAt: pairedToken.expiresAt,
        },
      },
      {
        name: 'Flexit 800131-000002',
        data: {
          id: 'plant-2',
          unitId: 'plant-2',
          plantId: 'plant-2',
        },
        settings: {
          plantId: 'plant-2',
        },
        store: {
          cloudAccessToken: pairedToken.accessToken,
          cloudRefreshToken: pairedToken.refreshToken,
          cloudTokenExpiresAt: pairedToken.expiresAt,
        },
      },
    ]);
  });

  it('surfaces pairing authentication failures with a user-facing error', async () => {
    const authFailure = new Error('bad credentials');
    const authClient = {
      authenticateWithPassword: sinon.stub().rejects(authFailure),
    };
    setCloudDriverMocks({
      clients: [authClient],
    });
    vi.resetModules();
    const mod = await import('../drivers/nordic-cloud/driver.ts');
    DriverClass = mod.default ?? mod;

    const driver = new DriverClass();
    const session = createSession();
    await driver.onPair(session);
    const loginHandler = session.handlers.get('login');

    let error: unknown;
    try {
      await loginHandler({ username: 'user@example.com', password: 'secret' });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Authentication failed. Check your credentials.');
    expect(driver.error.calledOnceWithExactly('[Pair] Cloud authentication failed:', authFailure)).toBe(true);
  });

  it('restores cloud auth for registered devices during repair without re-registering them', async () => {
    const repairedToken = {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: Date.now() + 86_400_000,
    };
    const authClient = {
      authenticateWithPassword: sinon.stub().resolves(repairedToken),
    };
    setCloudDriverMocks({
      clients: [authClient],
      registry: {
        hasCloudUnit: sinon.stub().returns(true),
      },
    });
    vi.resetModules();
    const mod = await import('../drivers/nordic-cloud/driver.ts');
    DriverClass = mod.default ?? mod;

    const session = createSession();
    const device = {
      getData: sinon.stub().returns({ unitId: 'unit-1', plantId: 'plant-1' }),
      getStoreValue: sinon.stub(),
      setStoreValue: sinon.stub().resolves(),
    };

    const driver = new DriverClass();
    await driver.onRepair(session, device);
    const loginHandler = session.handlers.get('login');

    const result = await loginHandler({ username: 'user@example.com', password: 'secret' });

    expect(result).toBe(true);
    expect(
      nordicCloudDriverMocks.registryStub.restoreCloudAuth.calledOnceWithExactly(
        'unit-1',
        repairedToken,
      ),
    ).toBe(true);
    expect(nordicCloudDriverMocks.registryStub.registerCloud.called).toBe(false);
    expect(device.setStoreValue.getCalls().map((call: any) => call.args)).toEqual([
      ['cloudAccessToken', repairedToken.accessToken],
      ['cloudRefreshToken', repairedToken.refreshToken],
      ['cloudTokenExpiresAt', repairedToken.expiresAt],
    ]);
  });

  it('reuses stored refresh token when repairing an unregistered device', async () => {
    const authenticatedToken = {
      accessToken: 'new-access-token',
      refreshToken: null,
      expiresAt: Date.now() + 86_400_000,
    };
    const authClient = {
      authenticateWithPassword: sinon.stub().resolves(authenticatedToken),
    };
    const repairClient = {
      restoreToken: sinon.stub(),
    };
    const activeClient = {
      onTokenRefreshed: sinon.stub(),
    };
    setCloudDriverMocks({
      clients: [authClient, repairClient],
      registry: {
        registerCloud: sinon.stub().returns(activeClient),
      },
    });
    vi.resetModules();
    const mod = await import('../drivers/nordic-cloud/driver.ts');
    DriverClass = mod.default ?? mod;

    const session = createSession();
    const device = {
      getData: sinon.stub().returns({ unitId: 'unit-1', plantId: 'plant-1' }),
      getStoreValue: sinon.stub().withArgs('cloudRefreshToken').returns('stored-refresh-token'),
      setStoreValue: sinon.stub().resolves(),
    };

    const driver = new DriverClass();
    await driver.onRepair(session, device);
    const loginHandler = session.handlers.get('login');

    const result = await loginHandler({ username: 'user@example.com', password: 'secret' });

    expect(result).toBe(true);
    expect(repairClient.restoreToken.calledOnceWithExactly({
      accessToken: 'new-access-token',
      refreshToken: 'stored-refresh-token',
      expiresAt: authenticatedToken.expiresAt,
    })).toBe(true);
    expect(nordicCloudDriverMocks.registryStub.registerCloud.calledOnceWithExactly(
      'unit-1',
      device,
      { plantId: 'plant-1', client: repairClient },
    )).toBe(true);
  });

  it('persists refreshed tokens from repair registration callbacks and logs store failures', async () => {
    const authenticatedToken = {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: Date.now() + 86_400_000,
    };
    const authClient = {
      authenticateWithPassword: sinon.stub().resolves(authenticatedToken),
    };
    const repairClient = {
      restoreToken: sinon.stub(),
    };
    let refreshedTokenHandler: ((token: {
      accessToken: string;
      refreshToken: string | null;
      expiresAt: number;
    }) => void) | undefined;
    const activeClient = {
      onTokenRefreshed: sinon.stub().callsFake((handler: typeof refreshedTokenHandler) => {
        refreshedTokenHandler = handler;
      }),
    };
    setCloudDriverMocks({
      clients: [authClient, repairClient],
      registry: {
        registerCloud: sinon.stub().returns(activeClient),
      },
    });
    vi.resetModules();
    const mod = await import('../drivers/nordic-cloud/driver.ts');
    DriverClass = mod.default ?? mod;

    const session = createSession();
    const device = {
      getData: sinon.stub().returns({ unitId: 'unit-1', plantId: 'plant-1' }),
      getStoreValue: sinon.stub(),
      setStoreValue: sinon.stub().resolves(),
    };
    device.setStoreValue.withArgs('cloudAccessToken', 'callback-access-token').rejects(new Error('access failed'));
    device.setStoreValue.withArgs('cloudRefreshToken', 'callback-refresh-token').rejects(new Error('refresh failed'));
    device.setStoreValue.withArgs('cloudTokenExpiresAt', 1234).rejects(new Error('expiry failed'));

    const driver = new DriverClass();
    await driver.onRepair(session, device);
    const loginHandler = session.handlers.get('login');

    await loginHandler({ username: 'user@example.com', password: 'secret' });
    device.setStoreValue.resetHistory();

    refreshedTokenHandler?.({
      accessToken: 'callback-access-token',
      refreshToken: 'callback-refresh-token',
      expiresAt: 1234,
    });
    await flushMicrotasks();

    expect(device.setStoreValue.calledWithExactly('cloudAccessToken', 'callback-access-token')).toBe(true);
    expect(device.setStoreValue.calledWithExactly('cloudRefreshToken', 'callback-refresh-token')).toBe(true);
    expect(device.setStoreValue.calledWithExactly('cloudTokenExpiresAt', 1234)).toBe(true);
    expect(driver.error.calledWithMatch('[Repair] Failed to persist cloud access token:')).toBe(true);
    expect(driver.error.calledWithMatch('[Repair] Failed to persist cloud refresh token:')).toBe(true);
    expect(driver.error.calledWithMatch('[Repair] Failed to persist cloud token expiry:')).toBe(true);
  });

  it('rejects repair when an unregistered device has no refresh token to restore', async () => {
    const authenticatedToken = {
      accessToken: 'new-access-token',
      refreshToken: null,
      expiresAt: Date.now() + 86_400_000,
    };
    const authClient = {
      authenticateWithPassword: sinon.stub().resolves(authenticatedToken),
    };
    const repairClient = {
      restoreToken: sinon.stub(),
    };
    setCloudDriverMocks({
      clients: [authClient, repairClient],
      registry: {
        registerCloud: sinon.stub(),
      },
    });
    vi.resetModules();
    const mod = await import('../drivers/nordic-cloud/driver.ts');
    DriverClass = mod.default ?? mod;

    const session = createSession();
    const device = {
      getData: sinon.stub().returns({ unitId: 'unit-1', plantId: 'plant-1' }),
      getStoreValue: sinon.stub().withArgs('cloudRefreshToken').returns(null),
      setStoreValue: sinon.stub().resolves(),
    };

    const driver = new DriverClass();
    await driver.onRepair(session, device);
    const loginHandler = session.handlers.get('login');

    let error: unknown;
    try {
      await loginHandler({ username: 'user@example.com', password: 'secret' });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'Authentication succeeded, but no refresh token is available for this device.',
    );
    expect(repairClient.restoreToken.called).toBe(false);
    expect(nordicCloudDriverMocks.registryStub.registerCloud.called).toBe(false);
    expect(device.setStoreValue.called).toBe(false);
  });

  it('surfaces repair authentication failures with a user-facing error', async () => {
    const authFailure = new Error('repair auth failed');
    const authClient = {
      authenticateWithPassword: sinon.stub().rejects(authFailure),
    };
    setCloudDriverMocks({
      clients: [authClient],
    });
    vi.resetModules();
    const mod = await import('../drivers/nordic-cloud/driver.ts');
    DriverClass = mod.default ?? mod;

    const session = createSession();
    const device = {
      getData: sinon.stub().returns({ unitId: 'unit-1', plantId: 'plant-1' }),
      getStoreValue: sinon.stub(),
      setStoreValue: sinon.stub().resolves(),
    };
    const driver = new DriverClass();

    await driver.onRepair(session, device);
    const loginHandler = session.handlers.get('login');

    let error: unknown;
    try {
      await loginHandler({ username: 'user@example.com', password: 'secret' });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Authentication failed. Check your credentials.');
    expect(driver.error.calledOnceWithExactly('[Repair] Cloud authentication failed:', authFailure)).toBe(true);
  });
});
