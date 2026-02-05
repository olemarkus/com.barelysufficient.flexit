import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

describe('UnitRegistry', () => {
  let Registry: any;
  let mockClient: any;
  let getBacnetClientStub: sinon.SinonStub;
  let mockDevice: any;

  beforeEach(() => {
    mockClient = {
      writeProperty: sinon.stub().yields(null, {}),
      readPropertyMultiple: sinon.stub().yields(null, { values: [] }),
      on: sinon.stub(),
    };

    getBacnetClientStub = sinon.stub().returns(mockClient);

    // Mock dependencies
    const UnitRegistryModule = proxyquire('../lib/UnitRegistry', {
      './bacnetClient': {
        getBacnetClient: getBacnetClientStub,
        BacnetEnums: {
          ApplicationTags: { REAL: 4, ENUMERATED: 9, UNSIGNED_INTEGER: 2 },
          MaxSegmentsAccepted: { SEGMENTS_0: 0 },
          MaxApduLengthAccepted: { OCTETS_1476: 5 },
          ObjectType: {
            ANALOG_INPUT: 0,
            ANALOG_OUTPUT: 1,
            ANALOG_VALUE: 2,
            BINARY_INPUT: 3,
            BINARY_VALUE: 5,
            MULTI_STATE_VALUE: 19,
            POSITIVE_INTEGER_VALUE: 48,
          },
        },
      },
      homey: {
        Device: class { },
      },
    });

    Registry = UnitRegistryModule.Registry;
  });

  afterEach(() => {
    if (mockDevice) {
      Registry.unregister('test_unit', mockDevice);
      mockDevice = null;
    }
  });

  it('should write fan mode correctly', async () => {
    // Mock a registered device
    mockDevice = {
      getSetting: sinon.stub(),
      getData: sinon.stub().returns({ role: 'fan', unitId: 'test_unit' }),
      setCapabilityValue: sinon.stub().resolves(),
      log: sinon.stub(),
      error: sinon.stub(),
    };
    mockDevice.getSetting.withArgs('ip').returns('127.0.0.1');
    mockDevice.getSetting.withArgs('bacnetPort').returns(47808);

    Registry.register('test_unit', mockDevice);

    // Trigger setFanMode
    await Registry.setFanMode('test_unit', 'away');

    // Verify writeProperty calls
    expect(mockClient.writeProperty.called).to.equal(true);

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const homeAway = callsByObject.get(JSON.stringify({ type: 5, instance: 50 })) as any[] | undefined;

    expect(homeAway).to.not.equal(undefined);
    if (!homeAway) {
      throw new Error('Expected write for homeAway');
    }

    expect(homeAway[0]).to.equal('127.0.0.1');
    expect(homeAway[2]).to.equal(85);
    expect(homeAway[3][0].type).to.equal(9); // ENUMERATED

    expect(homeAway[3][0].type).to.equal(9); // ENUMERATED
    expect(homeAway[3][0].value).to.equal(0);
    expect(homeAway[4].maxSegments).to.equal(0);
    expect(homeAway[4].maxApdu).to.equal(5);
    expect(homeAway[4].priority).to.equal(13);
  });

  it('writes setpoint with BACnet priority 13', async () => {
    mockDevice = {
      getSetting: sinon.stub(),
      getData: sinon.stub().returns({ role: 'thermostat', unitId: 'test_unit' }),
      setCapabilityValue: sinon.stub().resolves(),
      log: sinon.stub(),
      error: sinon.stub(),
    };
    mockDevice.getSetting.withArgs('ip').returns('127.0.0.1');
    mockDevice.getSetting.withArgs('bacnetPort').returns(47808);

    Registry.register('test_unit', mockDevice);

    await Registry.writeSetpoint('test_unit', 21.5);

    const { args } = mockClient.writeProperty.firstCall;
    expect(args[4].priority).to.equal(13);
  });

  it('writes high mode via ventilation mode when available', async () => {
    mockDevice = {
      getSetting: sinon.stub(),
      getData: sinon.stub().returns({ role: 'fan', unitId: 'test_unit' }),
      setCapabilityValue: sinon.stub().resolves(),
      log: sinon.stub(),
      error: sinon.stub(),
    };
    mockDevice.getSetting.withArgs('ip').returns('127.0.0.1');
    mockDevice.getSetting.withArgs('bacnetPort').returns(47808);

    Registry.register('test_unit', mockDevice);

    await Registry.setFanMode('test_unit', 'high');

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const comfort = callsByObject.get(JSON.stringify({ type: 5, instance: 50 })) as any[] | undefined;
    const ventilation = callsByObject.get(JSON.stringify({ type: 19, instance: 42 })) as any[] | undefined;

    expect(comfort).to.not.equal(undefined);
    expect(ventilation).to.not.equal(undefined);

    if (!comfort || !ventilation) {
      throw new Error('Expected comfort and ventilation writes');
    }

    expect(comfort[3][0].value).to.equal(1);
    expect(ventilation[3][0].type).to.equal(2); // UNSIGNED_INTEGER
    expect(ventilation[3][0].value).to.equal(4);
    expect(ventilation[4].priority).to.equal(13);
  });

  it('writes fireplace mode with runtime and trigger', async () => {
    mockDevice = {
      getSetting: sinon.stub(),
      getData: sinon.stub().returns({ role: 'fan', unitId: 'test_unit' }),
      setCapabilityValue: sinon.stub().resolves(),
      log: sinon.stub(),
      error: sinon.stub(),
    };
    mockDevice.getSetting.withArgs('ip').returns('127.0.0.1');
    mockDevice.getSetting.withArgs('bacnetPort').returns(47808);

    Registry.register('test_unit', mockDevice);

    await Registry.setFanMode('test_unit', 'fireplace');

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const comfort = callsByObject.get(JSON.stringify({ type: 5, instance: 50 })) as any[] | undefined;
    const runtime = callsByObject.get(JSON.stringify({ type: 48, instance: 270 })) as any[] | undefined;
    const trigger = callsByObject.get(JSON.stringify({ type: 19, instance: 360 })) as any[] | undefined;

    expect(comfort).to.not.equal(undefined);
    expect(runtime).to.not.equal(undefined);
    expect(trigger).to.not.equal(undefined);

    if (!runtime || !trigger || !comfort) {
      throw new Error('Expected comfort, runtime, and trigger writes');
    }

    expect(comfort[3][0].value).to.equal(1);
    expect(runtime[3][0].type).to.equal(2); // UNSIGNED_INTEGER
    expect(runtime[3][0].value).to.equal(10);
    expect(trigger[3][0].type).to.equal(2); // UNSIGNED_INTEGER
    expect(trigger[3][0].value).to.equal(2);
  });

  it('prefers active fireplace flag over operation mode', async () => {
    mockDevice = {
      getSetting: sinon.stub(),
      getData: sinon.stub().returns({ role: 'fan', unitId: 'test_unit' }),
      setCapabilityValue: sinon.stub().resolves(),
      log: sinon.stub(),
      error: sinon.stub(),
    };

    const unit = { devices: new Set([mockDevice]) };
    (Registry as any).distributeData(unit, {
      operation_mode: 3,
      fireplace_active: 1,
    });

    expect(mockDevice.setCapabilityValue.called).to.equal(true);
    const call = mockDevice.setCapabilityValue.lastCall;
    expect(call.args[0]).to.equal('fan_mode');
    expect(call.args[1]).to.equal('fireplace');
  });

  it('uses RF input mapping when available', async () => {
    mockDevice = {
      getSetting: sinon.stub(),
      getData: sinon.stub().returns({ role: 'fan', unitId: 'test_unit' }),
      setCapabilityValue: sinon.stub().resolves(),
      log: sinon.stub(),
      error: sinon.stub(),
    };

    const unit = { devices: new Set([mockDevice]) };
    (Registry as any).distributeData(unit, {
      comfort_button: 0,
      mode_rf_input: 3,
    });

    const call = mockDevice.setCapabilityValue.lastCall;
    expect(call.args[0]).to.equal('fan_mode');
    expect(call.args[1]).to.equal('high');
  });
});
