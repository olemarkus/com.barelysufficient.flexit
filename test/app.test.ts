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
        getDeviceTriggerCard: sinon.stub().returns({
          trigger: sinon.stub().resolves(),
        }),
      },
    };
  }
}

describe('App flow registration', () => {
  it('registers set_fan_profile_mode action listener and forwards writes', async () => {
    const registryStub = {
      setLogger: sinon.stub(),
      setFanSetpointChangedHandler: sinon.stub(),
      setFanProfileMode: sinon.stub().resolves(),
    };
    const card = {
      registerRunListener: sinon.stub(),
    };
    const supplyTriggerCard = {
      trigger: sinon.stub().resolves(),
    };
    const extractTriggerCard = {
      trigger: sinon.stub().resolves(),
    };

    const AppModule = proxyquireStrict('../app.ts', {
      homey: { App: MockHomeyApp },
      './lib/UnitRegistry': {
        Registry: registryStub,
        isFanProfileMode: (mode: unknown) => ['home', 'away', 'high', 'fireplace', 'cooker'].includes(String(mode)),
        normalizeFanProfilePercent: (value: number) => Math.round(value),
      },
      'source-map-support': {
        install: sinon.stub(),
      },
    });
    const AppClass = AppModule.default ?? AppModule;

    const app = new AppClass();
    app.homey.flow.getActionCard.returns(card);
    app.homey.flow.getDeviceTriggerCard
      .withArgs('supply_fan_setpoint_changed')
      .returns(supplyTriggerCard);
    app.homey.flow.getDeviceTriggerCard
      .withArgs('extract_fan_setpoint_changed')
      .returns(extractTriggerCard);

    await app.onInit();

    expect(app.homey.flow.getActionCard.calledOnceWithExactly('set_fan_profile_mode')).to.equal(true);
    expect(app.homey.flow.getDeviceTriggerCard.calledTwice).to.equal(true);
    expect(app.homey.flow.getDeviceTriggerCard.firstCall.args[0]).to.equal('supply_fan_setpoint_changed');
    expect(app.homey.flow.getDeviceTriggerCard.secondCall.args[0]).to.equal('extract_fan_setpoint_changed');
    expect(card.registerRunListener.calledOnce).to.equal(true);
    expect(registryStub.setFanSetpointChangedHandler.calledOnce).to.equal(true);

    const listener = card.registerRunListener.firstCall.args[0];
    const result = await listener({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      mode: 'home',
      supply_percent: 70,
      exhaust_percent: 60,
    });

    expect(result).to.equal(true);
    expect(registryStub.setFanProfileMode.calledOnceWithExactly('unit-1', 'home', 70, 60)).to.equal(true);

    const handler = registryStub.setFanSetpointChangedHandler.firstCall.args[0];
    await handler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      fan: 'supply',
      mode: 'home',
      setpointPercent: 81,
    });
    await handler({
      device: { getData: () => ({ unitId: 'unit-1' }) },
      fan: 'exhaust',
      mode: 'home',
      setpointPercent: 77,
    });
    expect(supplyTriggerCard.trigger.calledOnce).to.equal(true);
    expect(supplyTriggerCard.trigger.firstCall.args[1]).to.deep.equal({
      setpoint_percent: 81,
    });
    expect(extractTriggerCard.trigger.calledOnce).to.equal(true);
    expect(extractTriggerCard.trigger.firstCall.args[1]).to.deep.equal({
      setpoint_percent: 77,
    });
  });

  it('rejects unsupported flow mode values', async () => {
    const registryStub = {
      setLogger: sinon.stub(),
      setFanSetpointChangedHandler: sinon.stub(),
      setFanProfileMode: sinon.stub().resolves(),
    };
    const card = {
      registerRunListener: sinon.stub(),
    };

    const AppModule = proxyquireStrict('../app.ts', {
      homey: { App: MockHomeyApp },
      './lib/UnitRegistry': {
        Registry: registryStub,
        isFanProfileMode: (mode: unknown) => ['home', 'away', 'high', 'fireplace', 'cooker'].includes(String(mode)),
        normalizeFanProfilePercent: (value: number) => Math.round(value),
      },
      'source-map-support': {
        install: sinon.stub(),
      },
    });
    const AppClass = AppModule.default ?? AppModule;

    const app = new AppClass();
    app.homey.flow.getActionCard.returns(card);
    app.homey.flow.getDeviceTriggerCard.returns({ trigger: sinon.stub().resolves() });
    await app.onInit();

    const listener = card.registerRunListener.firstCall.args[0];

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
    const registryStub = {
      setLogger: sinon.stub(),
      setFanSetpointChangedHandler: sinon.stub(),
      setFanProfileMode: sinon.stub().resolves(),
    };
    const card = {
      registerRunListener: sinon.stub(),
    };

    const AppModule = proxyquireStrict('../app.ts', {
      homey: { App: MockHomeyApp },
      './lib/UnitRegistry': {
        Registry: registryStub,
        isFanProfileMode: (mode: unknown) => ['home', 'away', 'high', 'fireplace', 'cooker'].includes(String(mode)),
        normalizeFanProfilePercent: (value: number, mode: string, fan: string) => {
          if (mode === 'high' && fan === 'supply' && value < 80) {
            throw new Error('high supply fan profile must be between 80 and 100 percent');
          }
          return Math.round(value);
        },
      },
      'source-map-support': {
        install: sinon.stub(),
      },
    });
    const AppClass = AppModule.default ?? AppModule;

    const app = new AppClass();
    app.homey.flow.getActionCard.returns(card);
    app.homey.flow.getDeviceTriggerCard.returns({ trigger: sinon.stub().resolves() });
    await app.onInit();

    const listener = card.registerRunListener.firstCall.args[0];

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
