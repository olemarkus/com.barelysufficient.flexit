import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

const EXHAUST_TEMP_CAPABILITY = 'measure_temperature.exhaust';
const RESET_FILTER_CAPABILITY = 'button.reset_filter';
const proxyquireStrict = proxyquire.noCallThru().noPreserveCache();

class MockHomeyDevice {
  setClass = sinon.stub().resolves();
  hasCapability = sinon.stub();
  addCapability = sinon.stub().resolves();
  setSettings = sinon.stub().resolves();
  getSetting = sinon.stub().returns(undefined);
  registerCapabilityListener = sinon.stub();
  getData = sinon.stub().returns({ unitId: 'test_unit' });
  getName = sinon.stub().returns('Test Nordic');
  log = sinon.stub();
  error = sinon.stub();
}

describe('Nordic device', () => {
  let DeviceClass: any;
  let registryStub: any;
  let unitRegistryModuleStub: any;

  beforeEach(() => {
    registryStub = {
      register: sinon.stub(),
      unregister: sinon.stub(),
      writeSetpoint: sinon.stub().resolves(),
      setFanMode: sinon.stub().resolves(),
      resetFilterTimer: sinon.stub().resolves(),
      setFilterChangeInterval: sinon.stub().resolves(),
    };

    unitRegistryModuleStub = {
      Registry: registryStub,
      FILTER_CHANGE_INTERVAL_MONTHS_SETTING: 'filter_change_interval_months',
      FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING: 'filter_change_interval_hours',
      MIN_FILTER_CHANGE_INTERVAL_HOURS: 2196,
      MAX_FILTER_CHANGE_INTERVAL_HOURS: 8784,
      MIN_FILTER_CHANGE_INTERVAL_MONTHS: 3,
      MAX_FILTER_CHANGE_INTERVAL_MONTHS: 12,
      filterIntervalMonthsToHours: (months: number) => Math.round(months * 732),
      filterIntervalHoursToMonths: (hours: number) => Math.max(3, Math.min(12, Math.round(hours / 732))),
    };

    DeviceClass = proxyquireStrict('../drivers/nordic/device', {
      homey: { Device: MockHomeyDevice },
      '../../lib/UnitRegistry': unitRegistryModuleStub,
    });
  });

  it('adds exhaust capability during onInit when missing', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(false);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);

    await device.onInit();

    expect(device.addCapability.calledOnceWithExactly(EXHAUST_TEMP_CAPABILITY)).to.equal(true);
    expect(registryStub.register.calledOnceWithExactly('test_unit', device)).to.equal(true);
  });

  it('does not add exhaust capability during onInit when already present', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);

    await device.onInit();

    expect(device.addCapability.called).to.equal(false);
    expect(registryStub.register.calledOnceWithExactly('test_unit', device)).to.equal(true);
  });

  it('logs capability migration errors and continues initialization', async () => {
    const device = new DeviceClass();
    const err = new Error('add failed');
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(false);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
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
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);

    await device.onInit();

    expect(device.registerCapabilityListener.calledThrice).to.equal(true);
    expect(device.registerCapabilityListener.firstCall.args[0]).to.equal('target_temperature');
    expect(device.registerCapabilityListener.secondCall.args[0]).to.equal('fan_mode');
    expect(device.registerCapabilityListener.thirdCall.args[0]).to.equal(RESET_FILTER_CAPABILITY);

    const targetListener = device.registerCapabilityListener.firstCall.args[1];
    const fanModeListener = device.registerCapabilityListener.secondCall.args[1];
    const resetFilterListener = device.registerCapabilityListener.thirdCall.args[1];

    await targetListener(21.5);
    await fanModeListener('high');
    await resetFilterListener(true);

    expect(registryStub.writeSetpoint.calledOnceWithExactly('test_unit', 21.5)).to.equal(true);
    expect(registryStub.setFanMode.calledOnceWithExactly('test_unit', 'high')).to.equal(true);
    expect(registryStub.resetFilterTimer.calledOnceWithExactly('test_unit')).to.equal(true);
  });

  it('unregisters device on deletion', async () => {
    const device = new DeviceClass();

    await device.onDeleted();

    expect(registryStub.unregister.calledOnceWithExactly('test_unit', device)).to.equal(true);
  });

  it('accepts month bounds 3..12 for filter change interval', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    await device.onInit();

    await device.onSettings({
      newSettings: { filter_change_interval_months: 3 },
      changedKeys: ['filter_change_interval_months'],
    });
    await device.onSettings({
      newSettings: { filter_change_interval_months: 12 },
      changedKeys: ['filter_change_interval_months'],
    });

    expect(registryStub.setFilterChangeInterval.firstCall.args).to.deep.equal(['test_unit', 2196]);
    expect(registryStub.setFilterChangeInterval.secondCall.args).to.deep.equal(['test_unit', 8784]);
  });

  it('skips filter interval write when requested settings are already in sync', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    device.getSetting.withArgs('filter_change_interval_months').returns(6);
    device.getSetting.withArgs('filter_change_interval_hours').returns(4392);
    await device.onInit();

    await device.onSettings({
      newSettings: { filter_change_interval_months: 6 },
      changedKeys: ['filter_change_interval_months'],
    });

    expect(registryStub.setFilterChangeInterval.called).to.equal(false);
  });

  it('accepts legacy hour-based filter interval settings for backward compatibility', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    await device.onInit();

    await device.onSettings({
      newSettings: { filter_change_interval_hours: 5000 },
      changedKeys: ['filter_change_interval_hours'],
    });

    expect(registryStub.setFilterChangeInterval.calledOnceWithExactly('test_unit', 5000)).to.equal(true);
  });

  it('rejects month values outside 3..12', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    await device.onInit();

    let thrownLow: Error | null = null;
    try {
      await device.onSettings({
        newSettings: { filter_change_interval_months: 2 },
        changedKeys: ['filter_change_interval_months'],
      });
    } catch (error) {
      thrownLow = error as Error;
    }
    let thrownHigh: Error | null = null;
    try {
      await device.onSettings({
        newSettings: { filter_change_interval_months: 13 },
        changedKeys: ['filter_change_interval_months'],
      });
    } catch (error) {
      thrownHigh = error as Error;
    }

    expect(thrownLow).to.not.equal(null);
    expect(thrownHigh).to.not.equal(null);
    expect(thrownLow?.message).to.contain('between 3 and 12 months');
    expect(thrownHigh?.message).to.contain('between 3 and 12 months');
    expect(registryStub.setFilterChangeInterval.called).to.equal(false);
  });
});
