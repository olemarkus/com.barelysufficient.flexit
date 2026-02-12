import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

const EXHAUST_TEMP_CAPABILITY = 'measure_temperature.exhaust';
const proxyquireStrict = proxyquire.noCallThru().noPreserveCache();

class MockHomeyDevice {
  setClass = sinon.stub().resolves();
  hasCapability = sinon.stub();
  addCapability = sinon.stub().resolves();
  registerCapabilityListener = sinon.stub();
  getData = sinon.stub().returns({ unitId: 'test_unit' });
  getName = sinon.stub().returns('Test Nordic');
  log = sinon.stub();
  error = sinon.stub();
}

describe('Nordic device', () => {
  let DeviceClass: any;
  let registryStub: any;

  beforeEach(() => {
    registryStub = {
      register: sinon.stub(),
      unregister: sinon.stub(),
      writeSetpoint: sinon.stub().resolves(),
      setFanMode: sinon.stub().resolves(),
    };

    DeviceClass = proxyquireStrict('../drivers/nordic/device', {
      homey: { Device: MockHomeyDevice },
      '../../lib/UnitRegistry': {
        Registry: registryStub,
      },
    });
  });

  it('adds exhaust capability during onInit when missing', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(false);

    await device.onInit();

    expect(device.addCapability.calledOnceWithExactly(EXHAUST_TEMP_CAPABILITY)).to.equal(true);
    expect(registryStub.register.calledOnceWithExactly('test_unit', device)).to.equal(true);
  });

  it('does not add exhaust capability during onInit when already present', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);

    await device.onInit();

    expect(device.addCapability.called).to.equal(false);
    expect(registryStub.register.calledOnceWithExactly('test_unit', device)).to.equal(true);
  });

  it('logs capability migration errors and continues initialization', async () => {
    const device = new DeviceClass();
    const err = new Error('add failed');
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(false);
    device.addCapability.rejects(err);

    await device.onInit();

    expect(device.error.called).to.equal(true);
    expect(device.error.firstCall.args[0]).to.equal(`Failed adding capability '${EXHAUST_TEMP_CAPABILITY}':`);
    expect(device.error.firstCall.args[1]).to.equal(err);
    expect(registryStub.register.calledOnceWithExactly('test_unit', device)).to.equal(true);
  });

  it('registers capability listeners and forwards updates to registry', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);

    await device.onInit();

    expect(device.registerCapabilityListener.calledTwice).to.equal(true);
    expect(device.registerCapabilityListener.firstCall.args[0]).to.equal('target_temperature');
    expect(device.registerCapabilityListener.secondCall.args[0]).to.equal('fan_mode');

    const targetListener = device.registerCapabilityListener.firstCall.args[1];
    const fanModeListener = device.registerCapabilityListener.secondCall.args[1];

    await targetListener(21.5);
    await fanModeListener('high');

    expect(registryStub.writeSetpoint.calledOnceWithExactly('test_unit', 21.5)).to.equal(true);
    expect(registryStub.setFanMode.calledOnceWithExactly('test_unit', 'high')).to.equal(true);
  });

  it('unregisters device on deletion', async () => {
    const device = new DeviceClass();

    await device.onDeleted();

    expect(registryStub.unregister.calledOnceWithExactly('test_unit', device)).to.equal(true);
  });
});
