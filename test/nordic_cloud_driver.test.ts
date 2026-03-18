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

describe('Nordic cloud driver', () => {
  afterEach(() => {
    sinon.restore();
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
    const flexitCloudClientStub = sinon.stub();
    flexitCloudClientStub.onFirstCall().returns(authClient);
    flexitCloudClientStub.onSecondCall().returns(repairClient);

    const registryStub = {
      hasCloudUnit: sinon.stub().returns(false),
      restoreCloudAuth: sinon.stub(),
      registerCloud: sinon.stub().returns(activeClient),
    };

    const DriverClass = proxyquireStrict('../drivers/nordic-cloud/driver', {
      homey: { Driver: MockHomeyDriver },
      '../../lib/flexitCloudClient': {
        FlexitCloudClient: flexitCloudClientStub,
      },
      '../../lib/UnitRegistry': {
        Registry: registryStub,
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
    const flexitCloudClientStub = sinon.stub();
    flexitCloudClientStub.onFirstCall().returns(authClient);
    flexitCloudClientStub.onSecondCall().returns(repairClient);

    const registryStub = {
      hasCloudUnit: sinon.stub().returns(false),
      restoreCloudAuth: sinon.stub(),
      registerCloud: sinon.stub(),
    };

    const DriverClass = proxyquireStrict('../drivers/nordic-cloud/driver', {
      homey: { Driver: MockHomeyDriver },
      '../../lib/flexitCloudClient': {
        FlexitCloudClient: flexitCloudClientStub,
      },
      '../../lib/UnitRegistry': {
        Registry: registryStub,
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
