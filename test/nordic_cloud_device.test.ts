import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

const proxyquireStrict = proxyquire.noCallThru().noPreserveCache();

class MockCloudBaseDevice {
  initSharedCapabilities = sinon.stub().resolves();
  registerSharedCapabilityListeners = sinon.stub();
  getData = sinon.stub().returns({ unitId: 'unit-1', plantId: 'plant-1' });
  getName = sinon.stub().returns('Test Cloud Nordic');
  getStoreValue = sinon.stub().returns(undefined);
  setStoreValue = sinon.stub().resolves();
  setUnavailable = sinon.stub().resolves();
  log = sinon.stub();
  error = sinon.stub();
}

async function flushMicrotasks() {
  await Promise.resolve();
}

function createAuthenticationErrorConstructor(): typeof Error {
  function AuthenticationError(this: Error, message?: string) {
    this.name = 'AuthenticationError';
    this.message = message ?? '';
  }

  AuthenticationError.prototype = Object.create(Error.prototype);
  AuthenticationError.prototype.constructor = AuthenticationError;

  return AuthenticationError as unknown as typeof Error;
}

function loadDeviceClass(options?: {
  registry?: Record<string, any>;
  client?: Record<string, any>;
  AuthenticationError?: typeof Error;
}) {
  const registryStub = {
    registerCloud: sinon.stub(),
    ...(options?.registry ?? {}),
  };
  const client = {
    restoreToken: sinon.stub(),
    ...(options?.client ?? {}),
  };
  const AuthenticationErrorClass = options?.AuthenticationError ?? createAuthenticationErrorConstructor();
  const FlexitCloudClientStub = sinon.stub().returns(client);

  const DeviceClass = proxyquireStrict('../drivers/nordic-cloud/device', {
    '../../lib/UnitRegistry': {
      Registry: registryStub,
    },
    '../../lib/FlexitNordicBaseDevice': {
      FlexitNordicBaseDevice: MockCloudBaseDevice,
    },
    '../../lib/flexitCloudClient': {
      FlexitCloudClient: FlexitCloudClientStub,
      AuthenticationError: AuthenticationErrorClass,
    },
  });

  return {
    DeviceClass,
    registryStub,
    client,
    AuthenticationErrorClass,
  };
}

describe('Nordic cloud device', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('restores stored auth, registers the cloud unit, and subscribes to token refresh updates', async () => {
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
    const { DeviceClass, client, registryStub } = loadDeviceClass({
      registry: {
        registerCloud: sinon.stub().returns(activeClient),
      },
    });

    const device = new DeviceClass();
    device.getStoreValue.withArgs('cloudRefreshToken').returns('refresh-token');
    device.getStoreValue.withArgs('cloudAccessToken').returns('access-token');
    device.getStoreValue.withArgs('cloudTokenExpiresAt').returns(1234);

    await device.onInit();

    expect(device.initSharedCapabilities.calledOnce).to.equal(true);
    expect(client.restoreToken.calledOnceWithExactly({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1234,
    })).to.equal(true);
    expect(registryStub.registerCloud.calledOnceWithExactly(
      'unit-1',
      device,
      { plantId: 'plant-1', client },
    )).to.equal(true);
    expect(activeClient.onTokenRefreshed.calledOnce).to.equal(true);
    expect(device.registerSharedCapabilityListeners.calledOnceWithExactly('unit-1')).to.equal(true);

    refreshedTokenHandler?.({
      accessToken: 'updated-access-token',
      refreshToken: null,
      expiresAt: 5678,
    });
    await flushMicrotasks();

    expect(device.setStoreValue.calledWithExactly('cloudAccessToken', 'updated-access-token')).to.equal(true);
    expect(device.setStoreValue.calledWithExactly('cloudTokenExpiresAt', 5678)).to.equal(true);
    expect(device.setStoreValue.neverCalledWith('cloudRefreshToken', sinon.match.any)).to.equal(true);
  });

  it('marks the device unavailable when the stored refresh token is missing', async () => {
    const { DeviceClass, client, registryStub } = loadDeviceClass();
    const device = new DeviceClass();
    device.getStoreValue.withArgs('cloudRefreshToken').returns(null);

    await device.onInit();

    expect(client.restoreToken.called).to.equal(false);
    expect(device.error.calledOnceWithExactly('Cloud refresh token not found in device store')).to.equal(true);
    expect(device.setUnavailable.calledOnceWithExactly(
      'Cloud credentials missing. Please repair the device.',
    )).to.equal(true);
    expect(registryStub.registerCloud.called).to.equal(false);
    expect(device.registerSharedCapabilityListeners.called).to.equal(false);
  });

  it('marks the device unavailable when registry registration fails with an auth error', async () => {
    const { DeviceClass, registryStub, AuthenticationErrorClass } = loadDeviceClass();
    const device = new DeviceClass();
    device.getStoreValue.withArgs('cloudRefreshToken').returns('refresh-token');
    registryStub.registerCloud.throws(new AuthenticationErrorClass('expired token'));

    await device.onInit();

    expect(device.error.calledOnceWithExactly('Cloud authentication failed:', 'expired token')).to.equal(true);
    expect(device.setUnavailable.calledOnceWithExactly(
      'Cloud authentication failed. Please repair the device.',
    )).to.equal(true);
    expect(device.registerSharedCapabilityListeners.called).to.equal(false);
  });

  it('marks the device unavailable when registry registration fails unexpectedly', async () => {
    const failure = new Error('register failed');
    const { DeviceClass, registryStub } = loadDeviceClass();
    const device = new DeviceClass();
    device.getStoreValue.withArgs('cloudRefreshToken').returns('refresh-token');
    registryStub.registerCloud.throws(failure);

    await device.onInit();

    expect(device.error.calledOnceWithExactly('Failed to register with Registry:', failure)).to.equal(true);
    expect(device.setUnavailable.calledOnceWithExactly(
      'Failed to initialize cloud connection.',
    )).to.equal(true);
    expect(device.registerSharedCapabilityListeners.called).to.equal(false);
  });

  it('logs token persistence failures from refresh callbacks without interrupting the device', async () => {
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
    const { DeviceClass } = loadDeviceClass({
      registry: {
        registerCloud: sinon.stub().returns(activeClient),
      },
    });

    const device = new DeviceClass();
    device.getStoreValue.withArgs('cloudRefreshToken').returns('refresh-token');
    device.setStoreValue.withArgs('cloudAccessToken', 'next-access').rejects(new Error('access failed'));
    device.setStoreValue.withArgs('cloudRefreshToken', 'next-refresh').rejects(new Error('refresh failed'));
    device.setStoreValue.withArgs('cloudTokenExpiresAt', 9999).rejects(new Error('expiry failed'));

    await device.onInit();

    refreshedTokenHandler?.({
      accessToken: 'next-access',
      refreshToken: 'next-refresh',
      expiresAt: 9999,
    });
    await flushMicrotasks();

    expect(device.error.calledWithMatch('Failed to persist cloud access token:')).to.equal(true);
    expect(device.error.calledWithMatch('Failed to persist cloud refresh token:')).to.equal(true);
    expect(device.error.calledWithMatch('Failed to persist cloud token expiry:')).to.equal(true);
  });
});
