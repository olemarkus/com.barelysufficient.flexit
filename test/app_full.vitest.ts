import { afterEach, describe, expect, it } from 'vitest';
import sinon from 'sinon';
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

  app.homey.flow.getConditionCard
    .withArgs('dehumidification_is_active')
    .returns(cards.condition.dehumidificationIsActive);
  app.homey.flow.getConditionCard
    .withArgs('free_cooling_is_active')
    .returns(cards.condition.freeCoolingIsActive);
  app.homey.flow.getConditionCard.withArgs('heating_coil_is_on').returns(cards.condition.heatingCoilIsOn);

  app.homey.flow.getDeviceTriggerCard
    .withArgs('dehumidification_activated')
    .returns(cards.trigger.dehumidificationActivated);
  app.homey.flow.getDeviceTriggerCard
    .withArgs('dehumidification_deactivated')
    .returns(cards.trigger.dehumidificationDeactivated);
  app.homey.flow.getDeviceTriggerCard
    .withArgs('free_cooling_activated')
    .returns(cards.trigger.freeCoolingActivated);
  app.homey.flow.getDeviceTriggerCard
    .withArgs('free_cooling_deactivated')
    .returns(cards.trigger.freeCoolingDeactivated);
  app.homey.flow.getDeviceTriggerCard
    .withArgs('supply_fan_setpoint_changed')
    .returns(cards.trigger.supplyFanSetpointChanged);
  app.homey.flow.getDeviceTriggerCard
    .withArgs('extract_fan_setpoint_changed')
    .returns(cards.trigger.extractFanSetpointChanged);
  app.homey.flow.getDeviceTriggerCard
    .withArgs('heating_coil_turned_on')
    .returns(cards.trigger.heatingCoilTurnedOn);
  app.homey.flow.getDeviceTriggerCard
    .withArgs('heating_coil_turned_off')
    .returns(cards.trigger.heatingCoilTurnedOff);
}

describe('App flow registration', () => {
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
    expect(app.homey.flow.getActionCard.calledWithExactly('set_fireplace_duration')).toBe(true);
    expect(app.homey.flow.getActionCard.calledWithExactly('turn_heating_coil_on')).toBe(true);
    expect(app.homey.flow.getActionCard.calledWithExactly('turn_heating_coil_off')).toBe(true);
    expect(app.homey.flow.getActionCard.calledWithExactly('toggle_heating_coil_onoff')).toBe(true);

    expect(app.homey.flow.getConditionCard.calledWithExactly('dehumidification_is_active')).toBe(true);
    expect(app.homey.flow.getConditionCard.calledWithExactly('free_cooling_is_active')).toBe(true);
    expect(app.homey.flow.getConditionCard.calledWithExactly('heating_coil_is_on')).toBe(true);

    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('dehumidification_activated')).toBe(true);
    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('dehumidification_deactivated')).toBe(true);
    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('free_cooling_activated')).toBe(true);
    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('free_cooling_deactivated')).toBe(true);
    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('supply_fan_setpoint_changed')).toBe(true);
    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('extract_fan_setpoint_changed')).toBe(true);
    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('heating_coil_turned_on')).toBe(true);
    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('heating_coil_turned_off')).toBe(true);

    expect(cards.action.setFanProfileMode.registerRunListener.calledOnce).toBe(true);
    expect(cards.action.setFireplaceDuration.registerRunListener.calledOnce).toBe(true);
    expect(cards.action.turnHeatingCoilOn.registerRunListener.calledOnce).toBe(true);
    expect(cards.action.turnHeatingCoilOff.registerRunListener.calledOnce).toBe(true);
    expect(cards.action.toggleHeatingCoilOnOff.registerRunListener.calledOnce).toBe(true);
    expect(cards.condition.dehumidificationIsActive.registerRunListener.calledOnce).toBe(true);
    expect(cards.condition.freeCoolingIsActive.registerRunListener.calledOnce).toBe(true);
    expect(cards.condition.heatingCoilIsOn.registerRunListener.calledOnce).toBe(true);

    expect(registryStub.setFanSetpointChangedHandler.calledOnce).toBe(true);
    expect(registryStub.setDehumidificationStateChangedHandler.calledOnce).toBe(true);
    expect(registryStub.setFreeCoolingStateChangedHandler.calledOnce).toBe(true);
    expect(registryStub.setHeatingCoilStateChangedHandler.calledOnce).toBe(true);

    const fanProfileListener = cards.action.setFanProfileMode.registerRunListener.firstCall.args[0];
    const fanProfileResult = await fanProfileListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      mode: 'home',
      supply_percent: 70,
      exhaust_percent: 60,
    });
    expect(fanProfileResult).toBe(true);
    expect(registryStub.setFanProfileMode.calledOnceWithExactly('unit-1', 'home', 70, 60)).toBe(true);

    const fireplaceDurationListener = cards.action.setFireplaceDuration.registerRunListener.firstCall.args[0];
    const fireplaceDurationResult = await fireplaceDurationListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      minutes: 45,
    });
    expect(fireplaceDurationResult).toBe(true);
    expect(registryStub.setFireplaceVentilationDuration.calledOnceWithExactly('unit-1', 45)).toBe(true);

    const turnOnHeatingCoilListener = cards.action.turnHeatingCoilOn.registerRunListener.firstCall.args[0];
    const turnOnResult = await turnOnHeatingCoilListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
    });
    expect(turnOnResult).toBe(true);
    expect(registryStub.setHeatingCoilEnabled.calledWithExactly('unit-1', true)).toBe(true);

    const turnOffHeatingCoilListener = cards.action.turnHeatingCoilOff.registerRunListener.firstCall.args[0];
    const turnOffResult = await turnOffHeatingCoilListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
    });
    expect(turnOffResult).toBe(true);
    expect(registryStub.setHeatingCoilEnabled.calledWithExactly('unit-1', false)).toBe(true);

    const toggleHeatingCoilListener = cards.action.toggleHeatingCoilOnOff.registerRunListener.firstCall.args[0];
    const toggleResult = await toggleHeatingCoilListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
    });
    expect(toggleResult).toBe(true);
    expect(registryStub.toggleHeatingCoilEnabled.calledOnceWithExactly('unit-1')).toBe(true);

    const dehumidificationConditionListener = cards.condition
      .dehumidificationIsActive.registerRunListener.firstCall.args[0];
    const dehumidificationConditionResult = await dehumidificationConditionListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
    });
    expect(dehumidificationConditionResult).toBe(true);
    expect(registryStub.getDehumidificationActive.calledOnceWithExactly('unit-1')).toBe(true);

    const freeCoolingConditionListener = cards.condition
      .freeCoolingIsActive.registerRunListener.firstCall.args[0];
    const freeCoolingConditionResult = await freeCoolingConditionListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
    });
    expect(freeCoolingConditionResult).toBe(true);
    expect(registryStub.getFreeCoolingActive.calledOnceWithExactly('unit-1')).toBe(true);

    const heatingCoilConditionListener = cards.condition.heatingCoilIsOn.registerRunListener.firstCall.args[0];
    const heatingCoilConditionResult = await heatingCoilConditionListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
    });
    expect(heatingCoilConditionResult).toBe(true);
    expect(registryStub.getHeatingCoilEnabled.calledOnceWithExactly('unit-1')).toBe(true);

    const fanSetpointChangedHandler = registryStub.setFanSetpointChangedHandler.firstCall.args[0];
    await fanSetpointChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      fan: 'supply',
      mode: 'home',
      setpointPercent: 81,
    });
    await fanSetpointChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      fan: 'exhaust',
      mode: 'home',
      setpointPercent: 77,
    });
    expect(cards.trigger.supplyFanSetpointChanged.trigger.calledOnce).toBe(true);
    expect(cards.trigger.supplyFanSetpointChanged.trigger.firstCall.args[1]).toEqual({ setpoint_percent: 81 });
    expect(cards.trigger.extractFanSetpointChanged.trigger.calledOnce).toBe(true);
    expect(cards.trigger.extractFanSetpointChanged.trigger.firstCall.args[1]).toEqual({ setpoint_percent: 77 });

    const dehumidificationStateChangedHandler = registryStub.setDehumidificationStateChangedHandler.firstCall.args[0];
    await dehumidificationStateChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      active: true,
    });
    await dehumidificationStateChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      active: false,
    });
    expect(cards.trigger.dehumidificationActivated.trigger.calledOnce).toBe(true);
    expect(cards.trigger.dehumidificationDeactivated.trigger.calledOnce).toBe(true);

    const freeCoolingStateChangedHandler = registryStub.setFreeCoolingStateChangedHandler.firstCall.args[0];
    await freeCoolingStateChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      active: true,
    });
    await freeCoolingStateChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      active: false,
    });
    expect(cards.trigger.freeCoolingActivated.trigger.calledOnce).toBe(true);
    expect(cards.trigger.freeCoolingDeactivated.trigger.calledOnce).toBe(true);

    const heatingCoilStateChangedHandler = registryStub.setHeatingCoilStateChangedHandler.firstCall.args[0];
    await heatingCoilStateChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      enabled: true,
    });
    await heatingCoilStateChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      enabled: false,
    });
    expect(cards.trigger.heatingCoilTurnedOn.trigger.calledOnce).toBe(true);
    expect(cards.trigger.heatingCoilTurnedOff.trigger.calledOnce).toBe(true);
  });

  it('rejects unsupported flow mode values', async () => {
    const registryStub = createRegistryStub();
    const cards = createCards();
    const AppClass = createAppClass(registryStub);
    const app = new AppClass();
    wireCards(app, cards);
    await app.onInit();

    const listener = cards.action.setFanProfileMode.registerRunListener.firstCall.args[0];

    let thrown: Error | null = null;
    try {
      await listener({
        device: { getData: () => ({ unitId: 'unit-1' }) },
        mode: 'invalid',
        supply_percent: 70,
        exhaust_percent: 60,
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).not.toBe(null);
    expect(thrown?.message).toContain('Unsupported mode');
    expect(registryStub.setFanProfileMode.called).toBe(false);
  });

  it('rejects missing device unit ids for action cards', async () => {
    const registryStub = createRegistryStub();
    const cards = createCards();
    const AppClass = createAppClass(registryStub);
    const app = new AppClass();
    wireCards(app, cards);
    await app.onInit();

    const listener = cards.action.turnHeatingCoilOn.registerRunListener.firstCall.args[0];

    let thrown: Error | null = null;
    try {
      await listener({
        device: { getData: () => ({ unitId: '   ' }) },
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).not.toBe(null);
    expect(thrown?.message).toBe('Device unitId is missing.');
    expect(registryStub.setHeatingCoilEnabled.called).toBe(false);
  });

  it('rejects completely missing device objects for action cards', async () => {
    const registryStub = createRegistryStub();
    const cards = createCards();
    const AppClass = createAppClass(registryStub);
    const app = new AppClass();
    wireCards(app, cards);
    await app.onInit();

    const listener = cards.action.turnHeatingCoilOn.registerRunListener.firstCall.args[0];

    let thrown: Error | null = null;
    try {
      await listener({});
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.message).toBe('Device unitId is missing.');
    expect(registryStub.setHeatingCoilEnabled.called).toBe(false);
  });

  it('rejects out-of-range values for selected mode', async () => {
    const registryStub = createRegistryStub();
    const cards = createCards();
    const AppClass = createAppClass(
      registryStub,
      (value: number, mode: string, fan: string) => {
        if (mode === 'high' && fan === 'supply' && value < 80) {
          throw new Error('high supply fan profile must be between 80 and 100 percent');
        }
        return Math.round(value);
      },
    );
    const app = new AppClass();
    wireCards(app, cards);
    await app.onInit();

    const listener = cards.action.setFanProfileMode.registerRunListener.firstCall.args[0];

    let thrown: Error | null = null;
    try {
      await listener({
        device: { getData: () => ({ unitId: 'unit-1' }) },
        mode: 'high',
        supply_percent: 70,
        exhaust_percent: 90,
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).not.toBe(null);
    expect(thrown?.message).toContain('between 80 and 100');
    expect(registryStub.setFanProfileMode.called).toBe(false);
  });

  it('rejects missing mode and non-numeric fan percentages', async () => {
    const registryStub = createRegistryStub();
    const cards = createCards();
    const AppClass = createAppClass(registryStub);
    const app = new AppClass();
    wireCards(app, cards);
    await app.onInit();

    const listener = cards.action.setFanProfileMode.registerRunListener.firstCall.args[0];

    let missingModeError: Error | null = null;
    try {
      await listener({
        device: { getData: () => ({ unitId: 'unit-1' }) },
        supply_percent: 70,
        exhaust_percent: 60,
      });
    } catch (error) {
      missingModeError = error as Error;
    }

    let numericError: Error | null = null;
    try {
      await listener({
        device: { getData: () => ({ unitId: 'unit-1' }) },
        mode: 'home',
        supply_percent: 'oops',
        exhaust_percent: 60,
      });
    } catch (error) {
      numericError = error as Error;
    }

    expect(missingModeError?.message).toBe("Unsupported mode ''.");
    expect(numericError?.message).toBe('Supply and exhaust values must be numeric.');
    expect(registryStub.setFanProfileMode.called).toBe(false);
  });

  it('rejects non-numeric fireplace duration values', async () => {
    const registryStub = createRegistryStub();
    const cards = createCards();
    const AppClass = createAppClass(registryStub);
    const app = new AppClass();
    wireCards(app, cards);
    await app.onInit();

    const listener = cards.action.setFireplaceDuration.registerRunListener.firstCall.args[0];

    let thrown: Error | null = null;
    try {
      await listener({
        device: { getData: () => ({ unitId: 'unit-1' }) },
        minutes: 'invalid',
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).not.toBe(null);
    expect(thrown?.message).toContain('numeric');
    expect(registryStub.setFireplaceVentilationDuration.called).toBe(false);
  });

  it('logs trigger-card failures without throwing back into the registry callbacks', async () => {
    const registryStub = createRegistryStub();
    const cards = createCards();
    cards.trigger.supplyFanSetpointChanged.trigger.rejects(new Error('fan trigger failed'));
    cards.trigger.dehumidificationActivated.trigger.rejects(new Error('dehumidification trigger failed'));
    cards.trigger.heatingCoilTurnedOn.trigger.rejects(new Error('coil trigger failed'));

    const AppClass = createAppClass(registryStub);
    const app = new AppClass();
    wireCards(app, cards);
    await app.onInit();

    const fanSetpointChangedHandler = registryStub.setFanSetpointChangedHandler.firstCall.args[0];
    const dehumidificationStateChangedHandler = registryStub.setDehumidificationStateChangedHandler.firstCall.args[0];
    const heatingCoilStateChangedHandler = registryStub.setHeatingCoilStateChangedHandler.firstCall.args[0];

    await fanSetpointChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      fan: 'supply',
      setpointPercent: 81,
    });
    await dehumidificationStateChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      active: true,
    });
    await heatingCoilStateChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      enabled: true,
    });
    await Promise.resolve();

    expect(
      findStructuredLog(app.error, 'app.flow.trigger.fan_setpoint_changed.failed')?.error?.message,
    ).toBe('fan trigger failed');
    expect(
      findStructuredLog(app.error, 'app.flow.trigger.dehumidification_state.failed')?.error?.message,
    ).toBe('dehumidification trigger failed');
    expect(
      findStructuredLog(app.error, 'app.flow.trigger.heating_coil_state.failed')?.error?.message,
    ).toBe('coil trigger failed');
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

    expect(findStructuredLog(app.error, 'app.process.uncaught_exception')?.error?.message).toBe('uncaught');
    expect(findStructuredLog(app.error, 'app.process.unhandled_rejection')?.error?.message).toBe('rejection');
  });
});
