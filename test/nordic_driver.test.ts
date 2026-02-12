import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

const proxyquireStrict = proxyquire.noCallThru().noPreserveCache();

class MockHomeyDriver {
  homey = { manifest: { version: '1.0.2' } };
  manifest = { id: 'nordic' };
  log = sinon.stub();
  error = sinon.stub();
}

describe('Nordic driver', () => {
  let DriverClass: any;
  let discoverStub: sinon.SinonStub;

  beforeEach(() => {
    discoverStub = sinon.stub();
    DriverClass = proxyquireStrict('../drivers/nordic/driver', {
      homey: { Driver: MockHomeyDriver },
      '../../lib/flexitDiscovery': {
        discoverFlexitUnits: discoverStub,
      },
    });
  });

  it('logs app version during initialization', async () => {
    const driver = new DriverClass();

    await driver.onInit();

    expect(driver.log.calledWith('Flexit Nordic driver init (app v1.0.2)')).to.equal(true);
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

    expect(discoverStub.calledOnceWithExactly({
      timeoutMs: 5000,
      burstCount: 10,
      burstIntervalMs: 300,
    })).to.equal(true);
    expect(driver.log.calledWithMatch('[Pair] Discovery start')).to.equal(true);
    expect(driver.log.calledWithMatch('[Pair] Discovery complete: 1 unit(s) found in')).to.equal(true);
    expect(driver.log.calledWithMatch('[Pair] Units: 800131-000001@192.0.2.10:47808')).to.equal(true);
    expect(devices).to.deep.equal([
      {
        name: 'Nordic S4 REL',
        data: {
          id: '800131000001',
          unitId: '800131000001',
        },
        settings: {
          ip: '192.0.2.10',
          bacnetPort: 47808,
          serial: '800131-000001',
          mac: '02:00:00:00:00:01',
        },
      },
    ]);
  });

  it('logs discovery failure and rethrows', async () => {
    const err = new Error('multicast failed');
    discoverStub.rejects(err);
    const driver = new DriverClass();

    let thrown: unknown;
    try {
      await driver.onPairListDevices();
    } catch (e) {
      thrown = e;
    }

    expect(thrown).to.equal(err);
    expect(driver.error.called).to.equal(true);
    expect(driver.error.firstCall.args[0]).to.match(/^\[Pair\] Discovery failed after \d+ms:/);
    expect(driver.error.firstCall.args[1]).to.equal(err);
  });
});
