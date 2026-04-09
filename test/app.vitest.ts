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
    };
  }
}

function createRegistryStub(overrides: Record<string, any> = {}) {
  return {
    setLogger: sinon.stub(),
    setFanSetpointChangedHandler: sinon.stub(),
    setDehumidificationStateChangedHandler: sinon.stub(),
    setFreeCoolingStateChangedHandler: sinon.stub(),
    setHeatingCoilStateChangedHandler: sinon.stub(),
    setFanProfileMode: sinon.stub().resolves(),
    setFireplaceVentilationDuration: sinon.stub().resolves(),
    getDehumidificationActive: sinon.stub().resolves(true),
    getFreeCoolingActive: sinon.stub().resolves(true),
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
    installSourceMapSupport: sinon.stub(),
  });
}

function createCards() {
  return {
    action: {
      setFanProfileMode: { registerRunListener: sinon.stub() },
      setFireplaceDuration: { registerRunListener: sinon.stub() },
      turnHeatingCoilOn: { registerRunListener: sinon.stub() },
      turnHeatingCoilOff: { registerRunListener: sinon.stub() },
      toggleHeatingCoilOnOff: { registerRunListener: sinon.stub() },
    },
    condition: {
      dehumidificationIsActive: { registerRunListener: sinon.stub() },
      freeCoolingIsActive: { registerRunListener: sinon.stub() },
      heatingCoilIsOn: { registerRunListener: sinon.stub() },
    },
    trigger: {
      dehumidificationActivated: { trigger: sinon.stub().resolves() },
      dehumidificationDeactivated: { trigger: sinon.stub().resolves() },
      freeCoolingActivated: { trigger: sinon.stub().resolves() },
      freeCoolingDeactivated: { trigger: sinon.stub().resolves() },
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
  app.homey.flow.getActionCard.withArgs('turn_heating_coil_on').returns(cards.action.turnHeatingCoilOn);
  app.homey.flow.getActionCard.withArgs('turn_heating_coil_off').returns(cards.action.turnHeatingCoilOff);
  app.homey.flow.getActionCard.withArgs('toggle_heating_coil_onoff').returns(cards.action.toggleHeatingCoilOnOff);

  app.homey.flow.getConditionCard.withArgs('dehumidification_is_active')
    .returns(cards.condition.dehumidificationIsActive);
  app.homey.flow.getConditionCard.withArgs('free_cooling_is_active')
    .returns(cards.condition.freeCoolingIsActive);
  app.homey.flow.getConditionCard.withArgs('heating_coil_is_on').returns(cards.condition.heatingCoilIsOn);

  app.homey.flow.getDeviceTriggerCard.withArgs('dehumidification_activated')
    .returns(cards.trigger.dehumidificationActivated);
  app.homey.flow.getDeviceTriggerCard.withArgs('dehumidification_deactivated')
    .returns(cards.trigger.dehumidificationDeactivated);
  app.homey.flow.getDeviceTriggerCard.withArgs('free_cooling_activated')
    .returns(cards.trigger.freeCoolingActivated);
  app.homey.flow.getDeviceTriggerCard.withArgs('free_cooling_deactivated')
    .returns(cards.trigger.freeCoolingDeactivated);
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
