import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

const proxyquireStrict = proxyquire.noCallThru().noPreserveCache();

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

function loadDriverClass(options?: {
  clients?: any[];
  registry?: Record<string, any>;
}) {
  const registryStub = {
    hasCloudUnit: sinon.stub().returns(false),
    restoreCloudAuth: sinon.stub(),
    registerCloud: sinon.stub(),
    ...(options?.registry ?? {}),
  };
  const flexitCloudClientStub: any = sinon.stub();
  (options?.clients ?? []).forEach((client, index) => {
    flexitCloudClientStub.onCall(index).returns(client);
  });

  const DriverClass = proxyquireStrict('../drivers/nordic-cloud/driver', {
    homey: { Driver: MockHomeyDriver },
    '../../lib/flexitCloudClient': {
      FlexitCloudClient: flexitCloudClientStub,
    },
    '../../lib/UnitRegistry': {
      Registry: registryStub,
    },
  });

  return {
    DriverClass,
    registryStub,
  };
}

describe('Nordic cloud driver', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('logs app version during initialization', async () => {
    const { DriverClass } = loadDriverClass();
    const driver = new DriverClass();
    driver.homey = { manifest: { version: '1.2.3' } };
    driver.manifest = { version: '0.9.0' };

    await driver.onInit();

    expect(driver.log.calledOnceWithExactly('Flexit Nordic Cloud driver init (app v1.2.3)')).to.equal(true);
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
    const { DriverClass } = loadDriverClass({
      clients: [authClient, listClient],
    });

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

    expect(loginResult).to.equal(true);
    expect(listClient.restoreToken.calledOnceWithExactly(pairedToken)).to.equal(true);
    expect(driver.log.calledOnceWithExactly('[Pair] Found 2 plant(s) in Flexit cloud')).to.equal(true);
    expect(devices).to.deep.equal([
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

  it('requires a successful cloud login before listing paired devices', async () => {
    const { DriverClass } = loadDriverClass();
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

    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.equal('Not authenticated. Please log in first.');
  });

  it('surfaces pairing authentication failures with a user-facing error', async () => {
    const authFailure = new Error('bad credentials');
    const authClient = {
      authenticateWithPassword: sinon.stub().rejects(authFailure),
    };
    const { DriverClass } = loadDriverClass({
      clients: [authClient],
    });

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

    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.equal('Authentication failed. Check your credentials.');
    expect(driver.error.calledOnceWithExactly('[Pair] Cloud authentication failed:', authFailure)).to.equal(true);
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
    const { DriverClass, registryStub } = loadDriverClass({
      clients: [authClient],
      registry: {
        hasCloudUnit: sinon.stub().returns(true),
      },
    });

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

    expect(result).to.equal(true);
    expect(registryStub.restoreCloudAuth.calledOnceWithExactly('unit-1', repairedToken)).to.equal(true);
    expect(registryStub.registerCloud.called).to.equal(false);
    expect(device.setStoreValue.getCalls().map((call: any) => call.args)).to.deep.equal([
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
    const { DriverClass, registryStub } = loadDriverClass({
      clients: [authClient, repairClient],
      registry: {
        registerCloud: sinon.stub().returns(activeClient),
      },
    });

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

    expect(result).to.equal(true);
    expect(repairClient.restoreToken.calledOnceWithExactly({
      accessToken: 'new-access-token',
      refreshToken: 'stored-refresh-token',
      expiresAt: authenticatedToken.expiresAt,
    })).to.equal(true);
    expect(registryStub.registerCloud.calledOnceWithExactly(
      'unit-1',
      device,
      { plantId: 'plant-1', client: repairClient },
    )).to.equal(true);
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
    const { DriverClass } = loadDriverClass({
      clients: [authClient, repairClient],
      registry: {
        registerCloud: sinon.stub().returns(activeClient),
      },
    });

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

    expect(device.setStoreValue.calledWithExactly('cloudAccessToken', 'callback-access-token')).to.equal(true);
    expect(device.setStoreValue.calledWithExactly('cloudRefreshToken', 'callback-refresh-token')).to.equal(true);
    expect(device.setStoreValue.calledWithExactly('cloudTokenExpiresAt', 1234)).to.equal(true);
    expect(driver.error.calledWithMatch('[Repair] Failed to persist cloud access token:')).to.equal(true);
    expect(driver.error.calledWithMatch('[Repair] Failed to persist cloud refresh token:')).to.equal(true);
    expect(driver.error.calledWithMatch('[Repair] Failed to persist cloud token expiry:')).to.equal(true);
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
    const { DriverClass, registryStub } = loadDriverClass({
      clients: [authClient, repairClient],
      registry: {
        registerCloud: sinon.stub(),
      },
    });

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

    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.equal(
      'Authentication succeeded, but no refresh token is available for this device.',
    );
    expect(repairClient.restoreToken.called).to.equal(false);
    expect(registryStub.registerCloud.called).to.equal(false);
    expect(device.setStoreValue.called).to.equal(false);
  });
});
