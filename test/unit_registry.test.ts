import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

function makeMockDevice() {
  const device: any = {
    getSetting: sinon.stub(),
    getData: sinon.stub().returns({ unitId: 'test_unit' }),
    setCapabilityValue: sinon.stub().resolves(),
    setSetting: sinon.stub().resolves(),
    setAvailable: sinon.stub().resolves(),
    setUnavailable: sinon.stub().resolves(),
    log: sinon.stub(),
    error: sinon.stub(),
  };
  device.getSetting.withArgs('ip').returns('127.0.0.1');
  device.getSetting.withArgs('bacnetPort').returns(47808);
  device.getSetting.withArgs('serial').returns('800199-000001');
  return device;
}

const BACNET_ENUMS = {
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
};

function makeReadObject(type: number, instance: number, value: number) {
  return {
    objectId: { type, instance },
    values: [{ id: 85, value: [{ type: BACNET_ENUMS.ApplicationTags.REAL, value }] }],
  };
}

describe('UnitRegistry', () => {
  let UnitRegistryClass: any;
  let registry: any;
  let mockClient: any;
  let getBacnetClientStub: sinon.SinonStub;
  let discoverStub: sinon.SinonStub;

  beforeEach(() => {
    mockClient = {
      writeProperty: sinon.stub().yields(null, {}),
      readPropertyMultiple: sinon.stub().yields(null, { values: [] }),
      on: sinon.stub(),
    };

    getBacnetClientStub = sinon.stub().returns(mockClient);
    discoverStub = sinon.stub().resolves([]);

    const mod = proxyquire('../lib/UnitRegistry', {
      './bacnetClient': {
        getBacnetClient: getBacnetClientStub,
        BacnetEnums: BACNET_ENUMS,
      },
      './flexitDiscovery': {
        discoverFlexitUnits: discoverStub,
      },
    });

    UnitRegistryClass = mod.UnitRegistry;
    registry = new UnitRegistryClass();
  });

  afterEach(() => {
    registry.destroy();
  });

  it('should write fan mode correctly', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    await registry.setFanMode('test_unit', 'away');

    expect(mockClient.writeProperty.called).to.equal(true);

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const homeAway = callsByObject.get(JSON.stringify({ type: 5, instance: 50 })) as any[] | undefined;

    expect(homeAway).to.not.equal(undefined);
    if (!homeAway) throw new Error('Expected write for homeAway');

    expect(homeAway[0]).to.equal('127.0.0.1');
    expect(homeAway[2]).to.equal(85);
    expect(homeAway[3][0].type).to.equal(9); // ENUMERATED
    expect(homeAway[3][0].value).to.equal(0);
    expect(homeAway[4].maxSegments).to.equal(0);
    expect(homeAway[4].maxApdu).to.equal(5);
    expect(homeAway[4].priority).to.equal(13);
  });

  it('writes setpoint with BACnet priority 13', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    await registry.writeSetpoint('test_unit', 21.5);

    const { args } = mockClient.writeProperty.firstCall;
    expect(args[4].priority).to.equal(13);
  });

  it('writes high mode via ventilation mode when available', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    await registry.setFanMode('test_unit', 'high');

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const comfort = callsByObject.get(JSON.stringify({ type: 5, instance: 50 })) as any[] | undefined;
    const ventilation = callsByObject.get(JSON.stringify({ type: 19, instance: 42 })) as any[] | undefined;

    expect(comfort).to.not.equal(undefined);
    expect(ventilation).to.not.equal(undefined);

    if (!comfort || !ventilation) throw new Error('Expected comfort and ventilation writes');

    expect(comfort[3][0].value).to.equal(1);
    expect(ventilation[3][0].type).to.equal(2); // UNSIGNED_INTEGER
    expect(ventilation[3][0].value).to.equal(4);
    expect(ventilation[4].priority).to.equal(13);
  });

  it('writes fireplace mode with runtime and trigger', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    await registry.setFanMode('test_unit', 'fireplace');

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const comfort = callsByObject.get(JSON.stringify({ type: 5, instance: 50 })) as any[] | undefined;
    const runtime = callsByObject.get(JSON.stringify({ type: 48, instance: 270 })) as any[] | undefined;
    const trigger = callsByObject.get(JSON.stringify({ type: 19, instance: 360 })) as any[] | undefined;

    expect(comfort).to.not.equal(undefined);
    expect(runtime).to.not.equal(undefined);
    expect(trigger).to.not.equal(undefined);

    if (!runtime || !trigger || !comfort) throw new Error('Expected comfort, runtime, and trigger writes');

    expect(comfort[3][0].value).to.equal(1);
    expect(runtime[3][0].type).to.equal(2); // UNSIGNED_INTEGER
    expect(runtime[3][0].value).to.equal(10);
    expect(trigger[3][0].type).to.equal(2); // UNSIGNED_INTEGER
    expect(trigger[3][0].value).to.equal(2);
  });

  it('prefers active fireplace flag over operation mode', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = { unitId: 'test_unit', devices: new Set([mockDevice]) };
    (registry as any).distributeData(unit, {
      operation_mode: 3,
      fireplace_active: 1,
    });

    expect(mockDevice.setCapabilityValue.called).to.equal(true);
    const call = mockDevice.setCapabilityValue.lastCall;
    expect(call.args[0]).to.equal('fan_mode');
    expect(call.args[1]).to.equal('fireplace');
  });

  it('uses RF input mapping when available', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = { devices: new Set([mockDevice]) };
    (registry as any).distributeData(unit, {
      comfort_button: 0,
      mode_rf_input: 3,
    });

    const call = mockDevice.setCapabilityValue.lastCall;
    expect(call.args[0]).to.equal('fan_mode');
    expect(call.args[1]).to.equal('high');
  });

  it('marks device unavailable after consecutive poll failures', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    // Simulate 3 consecutive poll failures
    const unit = (registry as any).units.get('test_unit');
    (registry as any).handlePollFailure(unit);
    (registry as any).handlePollFailure(unit);
    (registry as any).handlePollFailure(unit);

    expect(mockDevice.setUnavailable.calledOnce).to.equal(true);
    expect(unit.available).to.equal(false);
  });

  it('marks device available again after poll success', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.available = false;
    unit.consecutiveFailures = 5;

    (registry as any).handlePollSuccess(unit);

    expect(mockDevice.setAvailable.called).to.equal(true);
    expect(unit.available).to.equal(true);
    expect(unit.consecutiveFailures).to.equal(0);
  });

  it('clamps setpoint to valid range', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    await registry.writeSetpoint('test_unit', 5);

    const { args } = mockClient.writeProperty.firstCall;
    expect(args[3][0].value).to.equal(10); // clamped to min

    mockClient.writeProperty.resetHistory();
    await registry.writeSetpoint('test_unit', 35);

    const args2 = mockClient.writeProperty.firstCall.args;
    expect(args2[3][0].value).to.equal(30); // clamped to max
  });

  it('destroy clears all intervals and units', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    expect((registry as any).units.size).to.equal(1);

    registry.destroy();

    expect((registry as any).units.size).to.equal(0);
  });

  it('polls both extract air temperature object variants', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    expect(mockClient.readPropertyMultiple.called).to.equal(true);
    const requestArray = mockClient.readPropertyMultiple.firstCall.args[1] as any[];
    const objectIds = requestArray.map((entry) => `${entry.objectId.type}:${entry.objectId.instance}`);

    expect(objectIds).to.include('0:11');
    expect(objectIds).to.include('0:59');
    expect(objectIds).to.include('0:95');
  });

  it('maps exhaust air temperature from AI 11 to capability', () => {
    const mockDevice = makeMockDevice();
    mockClient.readPropertyMultiple.callsFake((_ip: string, _requestArray: any[], cb: any) => {
      cb(null, {
        values: [
          makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_INPUT, 11, 2.1),
        ],
      });
    });

    registry.register('test_unit', mockDevice);
    (registry as any).pollUnit('test_unit');

    const exhaustTempCalls = mockDevice.setCapabilityValue
      .getCalls()
      .filter((call: any) => call.args[0] === 'measure_temperature.exhaust');

    expect(exhaustTempCalls.length).to.be.greaterThan(0);
    const lastCall = exhaustTempCalls[exhaustTempCalls.length - 1];
    expect(lastCall.args[1]).to.equal(2.1);
  });

  it('prefers extract air temperature from AI 59 when present', () => {
    const mockDevice = makeMockDevice();
    mockClient.readPropertyMultiple.callsFake((_ip: string, _requestArray: any[], cb: any) => {
      cb(null, {
        values: [
          makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_INPUT, 59, 21.4),
          makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_INPUT, 95, 0),
        ],
      });
    });

    registry.register('test_unit', mockDevice);
    (registry as any).pollUnit('test_unit');

    const extractTempCalls = mockDevice.setCapabilityValue
      .getCalls()
      .filter((call: any) => call.args[0] === 'measure_temperature.extract');

    expect(extractTempCalls.length).to.be.greaterThan(0);
    const lastCall = extractTempCalls[extractTempCalls.length - 1];
    expect(lastCall.args[1]).to.equal(21.4);
  });

  it('falls back to extract air temperature from AI 95 when AI 59 is zero', () => {
    const mockDevice = makeMockDevice();
    mockClient.readPropertyMultiple.callsFake((_ip: string, _requestArray: any[], cb: any) => {
      cb(null, {
        values: [
          makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_INPUT, 59, 0),
          makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_INPUT, 95, 20.8),
        ],
      });
    });

    registry.register('test_unit', mockDevice);
    (registry as any).pollUnit('test_unit');

    const extractTempCalls = mockDevice.setCapabilityValue
      .getCalls()
      .filter((call: any) => call.args[0] === 'measure_temperature.extract');

    expect(extractTempCalls.length).to.be.greaterThan(0);
    const lastCall = extractTempCalls[extractTempCalls.length - 1];
    expect(lastCall.args[1]).to.equal(20.8);
  });
});
