import sinon from 'sinon';
import { afterEach, describe, expect, it } from 'vitest';
import { createFlexitAppClass } from '../lib/createAppClass';
import { findStructuredLog } from './logging_test_utils';

class MockHomeyApp {
  homey: any;
  log = sinon.stub();
  error = sinon.stub();

  constructor() {
    this.homey = {
      flow: {
        getActionCard: sinon.stub().returns({
          registerRunListener: sinon.stub(),
        }),
        getConditionCard: sinon.stub().returns({
          registerRunListener: sinon.stub(),
        }),
        getDeviceTriggerCard: sinon.stub().returns({
          trigger: sinon.stub().resolves(),
        }),
      },
      drivers: {
        getDriver: sinon.stub().throws(new Error('Driver not found')),
      },
    };
  }
}

function createRegistryStub(overrides: Record<string, any> = {}) {
  return {
    setLogger: sinon.stub(),
    setFanSetpointChangedHandler: sinon.stub(),
    setDehumidificationStateChangedHandler: sinon.stub(),
    setFreeCoolingStateChangedHandler: sinon.stub(),
    setVentilationStoppedStateChangedHandler: sinon.stub(),
    setHeatingCoilStateChangedHandler: sinon.stub(),
    setFanProfileMode: sinon.stub().resolves(),
    setFireplaceVentilationDuration: sinon.stub().resolves(),
    setRapidVentilationDuration: sinon.stub().resolves(),
    activateTemporaryHigh: sinon.stub().resolves(),
    stopVentilation: sinon.stub().resolves(),
    getDehumidificationActive: sinon.stub().resolves(true),
    getFreeCoolingActive: sinon.stub().resolves(true),
    getVentilationStopped: sinon.stub().resolves(true),
    getModeWidgetSnapshot: sinon.stub().returns({
      unitId: 'unit-1',
      transport: 'bacnet',
      available: true,
      stale: false,
      fanMode: 'home',
      fanModeLabel: 'Home',
      fanModeDetail: 'Normal fan profile',
      modes: [],
      readings: [],
    }),
    setHeatingCoilEnabled: sinon.stub().resolves(),
    toggleHeatingCoilEnabled: sinon.stub().resolves(true),
    getHeatingCoilEnabled: sinon.stub().resolves(true),
    ...overrides,
  };
}

function createAppClass(registryStub: Record<string, any>, normalizeFanProfilePercent?: (...args: any[]) => number) {
  return createFlexitAppClass({
    HomeyApp: MockHomeyApp,
    registry: registryStub,
    isFanProfileMode: (mode: unknown) => ['home', 'away', 'high', 'fireplace', 'cooker'].includes(String(mode)),
    normalizeFanProfilePercent: normalizeFanProfilePercent ?? ((value: number) => Math.round(value)),
    normalizeFireplaceDurationMinutes: (value: unknown) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        throw new Error('Fireplace duration must be numeric');
      }
      const rounded = Math.round(numeric);
      if (rounded < 1 || rounded > 360) {
        throw new Error('Fireplace duration must be between 1 and 360 minutes');
      }
      return rounded;
    },
    normalizeHighDurationMinutes: (value: unknown) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        throw new Error('High duration must be numeric');
      }
      const rounded = Math.round(numeric);
      if (rounded < 0 || rounded > 360) {
        throw new Error('High duration must be between 0 and 360 minutes');
      }
      return rounded;
    },
    installSourceMapSupport: sinon.stub(),
  });
}

function createCards() {
  return {
    action: {
      setFanProfileMode: { registerRunListener: sinon.stub() },
      setFireplaceDuration: { registerRunListener: sinon.stub() },
      setHighDuration: { registerRunListener: sinon.stub() },
      activateTemporaryHigh: { registerRunListener: sinon.stub() },
      stopVentilation: { registerRunListener: sinon.stub() },
      turnHeatingCoilOn: { registerRunListener: sinon.stub() },
      turnHeatingCoilOff: { registerRunListener: sinon.stub() },
      toggleHeatingCoilOnOff: { registerRunListener: sinon.stub() },
    },
    condition: {
      dehumidificationIsActive: { registerRunListener: sinon.stub() },
      freeCoolingIsActive: { registerRunListener: sinon.stub() },
      ventilationIsStopped: { registerRunListener: sinon.stub() },
      heatingCoilIsOn: { registerRunListener: sinon.stub() },
    },
    trigger: {
      dehumidificationActivated: { trigger: sinon.stub().resolves() },
      dehumidificationDeactivated: { trigger: sinon.stub().resolves() },
      freeCoolingActivated: { trigger: sinon.stub().resolves() },
      freeCoolingDeactivated: { trigger: sinon.stub().resolves() },
      ventilationStopped: { trigger: sinon.stub().resolves() },
      ventilationResumed: { trigger: sinon.stub().resolves() },
      supplyFanSetpointChanged: { trigger: sinon.stub().resolves() },
      extractFanSetpointChanged: { trigger: sinon.stub().resolves() },
      heatingCoilTurnedOn: { trigger: sinon.stub().resolves() },
      heatingCoilTurnedOff: { trigger: sinon.stub().resolves() },
    },
  };
}

function wireCards(app: any, cards: ReturnType<typeof createCards>) {
  app.homey.flow.getActionCard.withArgs('set_fan_profile_mode').returns(cards.action.setFanProfileMode);
  app.homey.flow.getActionCard.withArgs('set_fireplace_duration').returns(cards.action.setFireplaceDuration);
  app.homey.flow.getActionCard.withArgs('set_high_duration').returns(cards.action.setHighDuration);
  app.homey.flow.getActionCard.withArgs('activate_temporary_high').returns(cards.action.activateTemporaryHigh);
  app.homey.flow.getActionCard.withArgs('stop_ventilation').returns(cards.action.stopVentilation);
  app.homey.flow.getActionCard.withArgs('turn_heating_coil_on').returns(cards.action.turnHeatingCoilOn);
  app.homey.flow.getActionCard.withArgs('turn_heating_coil_off').returns(cards.action.turnHeatingCoilOff);
  app.homey.flow.getActionCard.withArgs('toggle_heating_coil_onoff').returns(cards.action.toggleHeatingCoilOnOff);

  app.homey.flow.getConditionCard.withArgs('dehumidification_is_active')
    .returns(cards.condition.dehumidificationIsActive);
  app.homey.flow.getConditionCard.withArgs('free_cooling_is_active')
    .returns(cards.condition.freeCoolingIsActive);
  app.homey.flow.getConditionCard.withArgs('ventilation_is_stopped')
    .returns(cards.condition.ventilationIsStopped);
  app.homey.flow.getConditionCard.withArgs('heating_coil_is_on').returns(cards.condition.heatingCoilIsOn);

  app.homey.flow.getDeviceTriggerCard.withArgs('dehumidification_activated')
    .returns(cards.trigger.dehumidificationActivated);
  app.homey.flow.getDeviceTriggerCard.withArgs('dehumidification_deactivated')
    .returns(cards.trigger.dehumidificationDeactivated);
  app.homey.flow.getDeviceTriggerCard.withArgs('free_cooling_activated')
    .returns(cards.trigger.freeCoolingActivated);
  app.homey.flow.getDeviceTriggerCard.withArgs('free_cooling_deactivated')
    .returns(cards.trigger.freeCoolingDeactivated);
  app.homey.flow.getDeviceTriggerCard.withArgs('ventilation_stopped')
    .returns(cards.trigger.ventilationStopped);
  app.homey.flow.getDeviceTriggerCard.withArgs('ventilation_resumed')
    .returns(cards.trigger.ventilationResumed);
  app.homey.flow.getDeviceTriggerCard.withArgs('supply_fan_setpoint_changed')
    .returns(cards.trigger.supplyFanSetpointChanged);
  app.homey.flow.getDeviceTriggerCard.withArgs('extract_fan_setpoint_changed')
    .returns(cards.trigger.extractFanSetpointChanged);
  app.homey.flow.getDeviceTriggerCard.withArgs('heating_coil_turned_on').returns(cards.trigger.heatingCoilTurnedOn);
  app.homey.flow.getDeviceTriggerCard.withArgs('heating_coil_turned_off').returns(cards.trigger.heatingCoilTurnedOff);
}

describe('App flow registration (vitest)', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('registers dehumidification, free-cooling, and heating-coil flow cards and forwards callbacks', async () => {
    const registryStub = createRegistryStub();
    const cards = createCards();
    const AppClass = createAppClass(registryStub);
    const app = new AppClass();
    wireCards(app, cards);

    await app.onInit();

    expect(app.homey.flow.getActionCard.calledWithExactly('set_fan_profile_mode')).toBe(true);
    expect(app.homey.flow.getConditionCard.calledWithExactly('dehumidification_is_active')).toBe(true);
    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('dehumidification_activated')).toBe(true);
    expect(registryStub.setFanSetpointChangedHandler.calledOnce).toBe(true);

    const fanProfileListener = cards.action.setFanProfileMode.registerRunListener.firstCall.args[0];
    const fanProfileResult = await fanProfileListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      mode: 'home',
      supply_percent: 70,
      exhaust_percent: 60,
    });

    expect(fanProfileResult).toBe(true);
    expect(registryStub.setFanProfileMode.calledOnceWithExactly('unit-1', 'home', 70, 60)).toBe(true);
  });

  it('forwards the set high duration flow card to the registry', async () => {
    const registryStub = createRegistryStub();
    const cards = createCards();
    const AppClass = createAppClass(registryStub);
    const app = new AppClass();
    wireCards(app, cards);

    await app.onInit();

    expect(app.homey.flow.getActionCard.calledWithExactly('set_high_duration')).toBe(true);

    const highDurationListener = cards.action.setHighDuration.registerRunListener.firstCall.args[0];
    const result = await highDurationListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      minutes: 60,
    });

    expect(result).toBe(true);
    expect(registryStub.setRapidVentilationDuration.calledOnceWithExactly('unit-1', 60)).toBe(true);
  });

  it('forwards the activate temporary high flow card to the registry', async () => {
    const registryStub = createRegistryStub();
    const cards = createCards();
    const AppClass = createAppClass(registryStub);
    const app = new AppClass();
    wireCards(app, cards);

    await app.onInit();

    expect(app.homey.flow.getActionCard.calledWithExactly('activate_temporary_high')).toBe(true);

    const temporaryHighListener = cards.action.activateTemporaryHigh.registerRunListener.firstCall.args[0];
    const result = await temporaryHighListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
    });

    expect(result).toBe(true);
    expect(registryStub.activateTemporaryHigh.calledOnceWithExactly('unit-1')).toBe(true);
  });

  it('returns ventilation mode widget status for the selected Homey device', () => {
    const registryStub = createRegistryStub();
    const AppClass = createAppClass(registryStub);
    const app = new AppClass();
    const device = {
      getId: sinon.stub().returns('homey-device-1'),
      getName: sinon.stub().returns('Kitchen ventilation'),
      getAvailable: sinon.stub().returns(true),
      getData: sinon.stub().returns({ id: 'unit-1', unitId: 'unit-1' }),
      driver: { id: 'nordic' },
    };

    app.homey.drivers.getDriver.withArgs('nordic').returns({
      getDevices: sinon.stub().returns([device]),
    });

    const status = (app as any).getVentilationModesWidgetStatus('homey-device-1');

    expect(status.state).toBe('ready');
    expect(status.device.name).toBe('Kitchen ventilation');
    expect(status.device.unitId).toBe('unit-1');
    expect(status.fanModeLabel).toBe('Home');
    expect(registryStub.getModeWidgetSnapshot.calledOnceWithExactly('unit-1')).toBe(true);
  });

  it('returns unavailable widget status when the selected device has no unit id', () => {
    const registryStub = createRegistryStub();
    const AppClass = createAppClass(registryStub);
    const app = new AppClass();
    const device = {
      getId: sinon.stub().returns('homey-device-1'),
      getName: sinon.stub().returns('Incomplete ventilation'),
      getData: sinon.stub().returns({}),
    };

    app.homey.drivers.getDriver.withArgs('nordic').returns({
      getDevices: sinon.stub().returns([device]),
    });

    const status = (app as any).getVentilationModesWidgetStatus('homey-device-1');

    expect(status.state).toBe('unavailable');
    expect(status.message).toBe('Ventilation status is not available yet.');
    expect(registryStub.getModeWidgetSnapshot.called).toBe(false);
  });

  it('logs uncaughtException and unhandledRejection through global handlers', async () => {
    const registryStub = createRegistryStub();
    const AppClass = createAppClass(registryStub);
    const processOnStub = sinon.stub(process, 'on');
    const app = new AppClass();

    await app.onInit();

    const uncaughtHandler = processOnStub.withArgs('uncaughtException').firstCall.args[1];
    const rejectionHandler = processOnStub.withArgs('unhandledRejection').firstCall.args[1];
    const uncaught = new Error('uncaught');
    const rejection = new Error('rejection');

    uncaughtHandler(uncaught);
    rejectionHandler(rejection, Promise.resolve());

    const uncaughtLog = findStructuredLog(app.error, 'app.process.uncaught_exception');
    const rejectionLog = findStructuredLog(app.error, 'app.process.unhandled_rejection');
    expect(uncaughtLog?.msg).toBe('Unhandled process exception');
    expect(uncaughtLog?.error?.message).toBe('uncaught');
    expect(rejectionLog?.msg).toBe('Unhandled promise rejection');
    expect(rejectionLog?.error?.message).toBe('rejection');
  });
});
