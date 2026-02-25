import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

const proxyquireStrict = proxyquire.noCallThru().noPreserveCache();

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
    setHeatingCoilStateChangedHandler: sinon.stub(),
    setFanProfileMode: sinon.stub().resolves(),
    setHeatingCoilEnabled: sinon.stub().resolves(),
    toggleHeatingCoilEnabled: sinon.stub().resolves(true),
    getHeatingCoilEnabled: sinon.stub().resolves(true),
    ...overrides,
  };
}

function createAppClass(registryStub: Record<string, any>, normalizeFanProfilePercent?: (...args: any[]) => number) {
  const AppModule = proxyquireStrict('../app.ts', {
    homey: { App: MockHomeyApp },
    './lib/UnitRegistry': {
      Registry: registryStub,
      isFanProfileMode: (mode: unknown) => ['home', 'away', 'high', 'fireplace', 'cooker'].includes(String(mode)),
      normalizeFanProfilePercent: normalizeFanProfilePercent ?? ((value: number) => Math.round(value)),
    },
    'source-map-support': {
      install: sinon.stub(),
    },
  });
  return AppModule.default ?? AppModule;
}

function createCards() {
  return {
    action: {
      setFanProfileMode: { registerRunListener: sinon.stub() },
      turnHeatingCoilOn: { registerRunListener: sinon.stub() },
      turnHeatingCoilOff: { registerRunListener: sinon.stub() },
      toggleHeatingCoilOnOff: { registerRunListener: sinon.stub() },
    },
    condition: {
      heatingCoilIsOn: { registerRunListener: sinon.stub() },
    },
    trigger: {
      supplyFanSetpointChanged: { trigger: sinon.stub().resolves() },
      extractFanSetpointChanged: { trigger: sinon.stub().resolves() },
      heatingCoilTurnedOn: { trigger: sinon.stub().resolves() },
      heatingCoilTurnedOff: { trigger: sinon.stub().resolves() },
    },
  };
}

function wireCards(app: any, cards: ReturnType<typeof createCards>) {
  app.homey.flow.getActionCard.withArgs('set_fan_profile_mode').returns(cards.action.setFanProfileMode);
  app.homey.flow.getActionCard.withArgs('turn_heating_coil_on').returns(cards.action.turnHeatingCoilOn);
  app.homey.flow.getActionCard.withArgs('turn_heating_coil_off').returns(cards.action.turnHeatingCoilOff);
  app.homey.flow.getActionCard.withArgs('toggle_heating_coil_onoff').returns(cards.action.toggleHeatingCoilOnOff);

  app.homey.flow.getConditionCard.withArgs('heating_coil_is_on').returns(cards.condition.heatingCoilIsOn);

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
  it('registers heating-coil flow cards and forwards callbacks', async () => {
    const registryStub = createRegistryStub();
    const cards = createCards();
    const AppClass = createAppClass(registryStub);
    const app = new AppClass();
    wireCards(app, cards);

    await app.onInit();

    expect(app.homey.flow.getActionCard.calledWithExactly('set_fan_profile_mode')).to.equal(true);
    expect(app.homey.flow.getActionCard.calledWithExactly('turn_heating_coil_on')).to.equal(true);
    expect(app.homey.flow.getActionCard.calledWithExactly('turn_heating_coil_off')).to.equal(true);
    expect(app.homey.flow.getActionCard.calledWithExactly('toggle_heating_coil_onoff')).to.equal(true);

    expect(app.homey.flow.getConditionCard.calledOnceWithExactly('heating_coil_is_on')).to.equal(true);

    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('supply_fan_setpoint_changed')).to.equal(true);
    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('extract_fan_setpoint_changed')).to.equal(true);
    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('heating_coil_turned_on')).to.equal(true);
    expect(app.homey.flow.getDeviceTriggerCard.calledWithExactly('heating_coil_turned_off')).to.equal(true);

    expect(cards.action.setFanProfileMode.registerRunListener.calledOnce).to.equal(true);
    expect(cards.action.turnHeatingCoilOn.registerRunListener.calledOnce).to.equal(true);
    expect(cards.action.turnHeatingCoilOff.registerRunListener.calledOnce).to.equal(true);
    expect(cards.action.toggleHeatingCoilOnOff.registerRunListener.calledOnce).to.equal(true);
    expect(cards.condition.heatingCoilIsOn.registerRunListener.calledOnce).to.equal(true);

    expect(registryStub.setFanSetpointChangedHandler.calledOnce).to.equal(true);
    expect(registryStub.setHeatingCoilStateChangedHandler.calledOnce).to.equal(true);

    const fanProfileListener = cards.action.setFanProfileMode.registerRunListener.firstCall.args[0];
    const fanProfileResult = await fanProfileListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      mode: 'home',
      supply_percent: 70,
      exhaust_percent: 60,
    });
    expect(fanProfileResult).to.equal(true);
    expect(registryStub.setFanProfileMode.calledOnceWithExactly('unit-1', 'home', 70, 60)).to.equal(true);

    const turnOnHeatingCoilListener = cards.action.turnHeatingCoilOn.registerRunListener.firstCall.args[0];
    const turnOnResult = await turnOnHeatingCoilListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
    });
    expect(turnOnResult).to.equal(true);
    expect(registryStub.setHeatingCoilEnabled.calledWithExactly('unit-1', true)).to.equal(true);

    const turnOffHeatingCoilListener = cards.action.turnHeatingCoilOff.registerRunListener.firstCall.args[0];
    const turnOffResult = await turnOffHeatingCoilListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
    });
    expect(turnOffResult).to.equal(true);
    expect(registryStub.setHeatingCoilEnabled.calledWithExactly('unit-1', false)).to.equal(true);

    const toggleHeatingCoilListener = cards.action.toggleHeatingCoilOnOff.registerRunListener.firstCall.args[0];
    const toggleResult = await toggleHeatingCoilListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
    });
    expect(toggleResult).to.equal(true);
    expect(registryStub.toggleHeatingCoilEnabled.calledOnceWithExactly('unit-1')).to.equal(true);

    const heatingCoilConditionListener = cards.condition.heatingCoilIsOn.registerRunListener.firstCall.args[0];
    const heatingCoilConditionResult = await heatingCoilConditionListener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
    });
    expect(heatingCoilConditionResult).to.equal(true);
    expect(registryStub.getHeatingCoilEnabled.calledOnceWithExactly('unit-1')).to.equal(true);

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
    expect(cards.trigger.supplyFanSetpointChanged.trigger.calledOnce).to.equal(true);
    expect(cards.trigger.supplyFanSetpointChanged.trigger.firstCall.args[1]).to.deep.equal({ setpoint_percent: 81 });
    expect(cards.trigger.extractFanSetpointChanged.trigger.calledOnce).to.equal(true);
    expect(cards.trigger.extractFanSetpointChanged.trigger.firstCall.args[1]).to.deep.equal({ setpoint_percent: 77 });

    const heatingCoilStateChangedHandler = registryStub.setHeatingCoilStateChangedHandler.firstCall.args[0];
    await heatingCoilStateChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      enabled: true,
    });
    await heatingCoilStateChangedHandler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      enabled: false,
    });
    expect(cards.trigger.heatingCoilTurnedOn.trigger.calledOnce).to.equal(true);
    expect(cards.trigger.heatingCoilTurnedOff.trigger.calledOnce).to.equal(true);
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

    expect(thrown).to.not.equal(null);
    expect(thrown?.message).to.contain('Unsupported mode');
    expect(registryStub.setFanProfileMode.called).to.equal(false);
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

    expect(thrown).to.not.equal(null);
    expect(thrown?.message).to.contain('between 80 and 100');
    expect(registryStub.setFanProfileMode.called).to.equal(false);
  });
});
