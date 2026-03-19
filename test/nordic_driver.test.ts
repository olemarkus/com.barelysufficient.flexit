import { expect } from 'chai';
import { createRequire } from 'module';
import sinon from 'sinon';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const proxyquire = require('proxyquire');

const proxyquireStrict = proxyquire.noCallThru().noPreserveCache();

class MockHomeyDriver {
  homey = { manifest: { version: '1.0.2' } };
  manifest = { id: 'nordic' };
  log = sinon.stub();
  error = sinon.stub();
  getDevices = sinon.stub().returns([]);
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
    const discoverArgs = discoverStub.firstCall.args[0];

    expect(discoverStub.calledOnce).to.equal(true);
    expect(discoverArgs.timeoutMs).to.equal(5000);
    expect(discoverArgs.burstCount).to.equal(10);
    expect(discoverArgs.burstIntervalMs).to.equal(300);
    expect(discoverArgs.log).to.be.a('function');
    expect(discoverArgs.error).to.be.a('function');
    discoverArgs.log('[Discovery] test log');
    discoverArgs.error('[Discovery] test error');
    expect(driver.log.calledWithMatch('[Pair] Discovery start')).to.equal(true);
    expect(driver.log.calledWithExactly('[Discovery] test log')).to.equal(true);
    expect(driver.error.calledWithExactly('[Discovery] test error')).to.equal(true);
    expect(driver.log.calledWithMatch('[Pair] Discovery complete: 1 unit(s) found in')).to.equal(true);
    expect(driver.log.calledWithExactly('[Pair] Unit 800131-000001@192.0.2.10:47808 (new)')).to.equal(true);
    expect(devices).to.deep.equal([
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

  it('falls back to driver manifest version when homey manifest is unavailable', async () => {
    const driver = new DriverClass();
    driver.homey = {};
    driver.manifest = { version: '2.4.6' };

    await driver.onInit();

    expect(driver.log.calledWith('Flexit Nordic driver init (app v2.4.6)')).to.equal(true);
  });

  it('omits unit summary logging when discovery returns no units', async () => {
    discoverStub.resolves([]);
    const driver = new DriverClass();

    const devices = await driver.onPairListDevices();

    expect(devices).to.deep.equal([]);
    expect(driver.log.calledWithMatch('[Pair] Discovery complete: 0 unit(s) found in')).to.equal(true);
    expect(driver.log.calledWithMatch('[Pair] Unit ')).to.equal(false);
  });

  it('logs every discovered unit without truncation', async () => {
    discoverStub.resolves(Array.from({ length: 6 }, (_value, index) => ({
      name: `Unit ${index + 1}`,
      serialNormalized: `80013100000${index + 1}`,
      ip: `192.0.2.${index + 10}`,
      bacnetPort: 47808 + index,
      serial: `800131-00000${index + 1}`,
      mac: '',
    })));
    const driver = new DriverClass();

    await driver.onPairListDevices();

    expect(driver.log.getCalls().filter((call) => /^\[Pair\] Unit /.test(call.args[0])).length).to.equal(6);
    expect(driver.log.calledWithExactly('[Pair] Unit 800131-000006@192.0.2.15:47813 (new)')).to.equal(true);
  });

  it('logs already added units distinctly', async () => {
    discoverStub.resolves([
      {
        name: 'Nordic S4 REL',
        serialNormalized: '800131000001',
        ip: '192.0.2.10',
        bacnetPort: 47808,
        serial: '800131-000001',
        mac: '02:00:00:00:00:01',
      },
      {
        name: 'Nordic S4 REL',
        serialNormalized: '800131000002',
        ip: '192.0.2.11',
        bacnetPort: 47808,
        serial: '800131-000002',
        mac: '02:00:00:00:00:02',
      },
    ]);
    const driver = new DriverClass();
    driver.getDevices.returns([
      {
        getData: () => ({ unitId: '800131000001' }),
      },
    ]);

    await driver.onPairListDevices();

    expect(driver.log.calledWithExactly('[Pair] Unit 800131-000001@192.0.2.10:47808 (already added)')).to.equal(true);
    expect(driver.log.calledWithExactly('[Pair] Unit 800131-000002@192.0.2.11:47808 (new)')).to.equal(true);
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
