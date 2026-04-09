import sinon from 'sinon';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeLogger, RuntimeLogger } from '../lib/logging';
import { findStructuredLog } from './logging_test_utils';

class MockCloudBaseDevice {
  private runtimeLogger?: RuntimeLogger;
  initSharedCapabilities = sinon.stub().resolves();
  registerSharedCapabilityListeners = sinon.stub();
  getData = sinon.stub().returns({ unitId: 'unit-1', plantId: 'plant-1' });
  getName = sinon.stub().returns('Test Cloud Nordic');
  getStoreValue = sinon.stub().returns(undefined);
  setStoreValue = sinon.stub().resolves();
  setUnavailable = sinon.stub().resolves();
  log = sinon.stub();
  error = sinon.stub();

  getLogger() {
    if (!this.runtimeLogger) {
      this.runtimeLogger = createRuntimeLogger(this, {
        component: 'device',
        transport: 'cloud',
        unitId: 'unit-1',
        plantId: 'plant-1',
      });
    }
    return this.runtimeLogger;
  }
}

function createAuthenticationErrorConstructor(): typeof Error {
  return class AuthenticationError extends Error {
    constructor(message?: string) {
      super(message ?? '');
      this.name = 'AuthenticationError';
    }
  };
}

const nordicCloudDeviceMocks = vi.hoisted(() => ({
  registryStub: {} as Record<string, any>,
  clientFactory: [] as any[],
  lastClient: null as any,
  AuthenticationErrorClass: createAuthenticationErrorConstructor(),
}));

vi.mock('../lib/UnitRegistry', () => ({
  Registry: nordicCloudDeviceMocks.registryStub,
}));

vi.mock('../lib/FlexitNordicBaseDevice', () => ({
  FlexitNordicBaseDevice: MockCloudBaseDevice,
}));

vi.mock('../lib/flexitCloudClient', () => ({
  FlexitCloudClient: function MockedFlexitCloudClient(this: any) {
    const client = nordicCloudDeviceMocks.clientFactory.shift();
    nordicCloudDeviceMocks.lastClient = client;
    return client;
  },
  AuthenticationError: nordicCloudDeviceMocks.AuthenticationErrorClass,
}));

function setCloudDeviceMocks(options?: {
  registry?: Record<string, any>;
  clients?: any[];
}) {
  for (const key of Object.keys(nordicCloudDeviceMocks.registryStub)) {
    delete nordicCloudDeviceMocks.registryStub[key];
  }
  Object.assign(nordicCloudDeviceMocks.registryStub, {
    registerCloud: sinon.stub(),
    ...(options?.registry ?? {}),
  });
  nordicCloudDeviceMocks.clientFactory = options?.clients ?? [{
    restoreToken: sinon.stub(),
  }];
  nordicCloudDeviceMocks.lastClient = null;
}

async function flushMicrotasks() {
  await Promise.resolve();
}

describe('Nordic cloud device (vitest)', () => {
  let DeviceClass: any;

  beforeEach(async () => {
    vi.resetModules();
    setCloudDeviceMocks();
    const mod = await import('../drivers/nordic-cloud/device.ts');
    DeviceClass = mod.default ?? mod;
  });

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
    const client = {
      restoreToken: sinon.stub(),
    };
    setCloudDeviceMocks({
      clients: [client],
      registry: {
        registerCloud: sinon.stub().returns(activeClient),
      },
    });
    vi.resetModules();
    const mod = await import('../drivers/nordic-cloud/device.ts');
    DeviceClass = mod.default ?? mod;

    const device = new DeviceClass();
    device.getStoreValue.withArgs('cloudRefreshToken').returns('refresh-token');
    device.getStoreValue.withArgs('cloudAccessToken').returns('access-token');
    device.getStoreValue.withArgs('cloudTokenExpiresAt').returns(1234);

    await device.onInit();

    expect(device.initSharedCapabilities.calledOnce).toBe(true);
    expect(client.restoreToken.calledOnceWithExactly({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1234,
    })).toBe(true);
    expect(nordicCloudDeviceMocks.registryStub.registerCloud.calledOnceWithExactly(
      'unit-1',
      device,
      { plantId: 'plant-1', client },
    )).toBe(true);
    expect(activeClient.onTokenRefreshed.calledOnce).toBe(true);
    expect(device.registerSharedCapabilityListeners.calledOnceWithExactly('unit-1')).toBe(true);

    refreshedTokenHandler?.({
      accessToken: 'updated-access-token',
      refreshToken: null,
      expiresAt: 5678,
    });
    await flushMicrotasks();

    expect(device.setStoreValue.calledWithExactly('cloudAccessToken', 'updated-access-token')).toBe(true);
    expect(device.setStoreValue.calledWithExactly('cloudTokenExpiresAt', 5678)).toBe(true);
    expect(device.setStoreValue.neverCalledWith('cloudRefreshToken', sinon.match.any)).toBe(true);
  });

  it('marks the device unavailable when the stored refresh token is missing', async () => {
    const device = new DeviceClass();
    device.getStoreValue.withArgs('cloudRefreshToken').returns(null);

    await device.onInit();

    expect(nordicCloudDeviceMocks.lastClient.restoreToken.called).toBe(false);
    expect(
      findStructuredLog(device.error, 'device.token_restore.missing_refresh_token')?.msg,
    ).toBe('Cloud refresh token was not found in device store');
    expect(device.setUnavailable.calledOnceWithExactly(
      'Cloud credentials missing. Please repair the device.',
    )).toBe(true);
    expect(nordicCloudDeviceMocks.registryStub.registerCloud.called).toBe(false);
    expect(device.registerSharedCapabilityListeners.called).toBe(false);
  });

  it('marks the device unavailable when registry registration fails with an auth error', async () => {
    setCloudDeviceMocks({
      registry: {
        registerCloud: sinon.stub().throws(
          new nordicCloudDeviceMocks.AuthenticationErrorClass('expired token'),
        ),
      },
    });
    vi.resetModules();
    const mod = await import('../drivers/nordic-cloud/device.ts');
    DeviceClass = mod.default ?? mod;

    const device = new DeviceClass();
    device.getStoreValue.withArgs('cloudRefreshToken').returns('refresh-token');

    await device.onInit();

    const authLog = findStructuredLog(device.error, 'device.cloud_auth.failed');
    expect(authLog?.error?.message).toBe('expired token');
    expect(device.setUnavailable.calledOnceWithExactly(
      'Cloud authentication failed. Please repair the device.',
    )).toBe(true);
    expect(device.registerSharedCapabilityListeners.called).toBe(false);
  });

  it('marks the device unavailable when registry registration fails unexpectedly', async () => {
    const failure = new Error('register failed');
    setCloudDeviceMocks({
      registry: {
        registerCloud: sinon.stub().throws(failure),
      },
    });
    vi.resetModules();
    const mod = await import('../drivers/nordic-cloud/device.ts');
    DeviceClass = mod.default ?? mod;

    const device = new DeviceClass();
    device.getStoreValue.withArgs('cloudRefreshToken').returns('refresh-token');

    await device.onInit();

    expect(findStructuredLog(device.error, 'device.registry.register.failed')?.error?.message).toBe('register failed');
    expect(device.setUnavailable.calledOnceWithExactly(
      'Failed to initialize cloud connection.',
    )).toBe(true);
    expect(device.registerSharedCapabilityListeners.called).toBe(false);
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
    setCloudDeviceMocks({
      registry: {
        registerCloud: sinon.stub().returns(activeClient),
      },
    });
    vi.resetModules();
    const mod = await import('../drivers/nordic-cloud/device.ts');
    DeviceClass = mod.default ?? mod;

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

    expect(
      findStructuredLog(device.error, 'device.token_persist.access.failed')?.error?.message,
    ).toBe('access failed');
    expect(
      findStructuredLog(device.error, 'device.token_persist.refresh.failed')?.error?.message,
    ).toBe('refresh failed');
    expect(
      findStructuredLog(device.error, 'device.token_persist.expiry.failed')?.error?.message,
    ).toBe('expiry failed');
  });
});
