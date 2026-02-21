import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

const FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH = 732;
const MIN_FILTER_CHANGE_INTERVAL_HOURS = 3 * FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH;
const MAX_FILTER_CHANGE_INTERVAL_HOURS = 12 * FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH;

function makeMockDevice() {
  const device: any = {
    getSetting: sinon.stub(),
    getData: sinon.stub().returns({ unitId: 'test_unit' }),
    setCapabilityValue: sinon.stub().resolves(),
    setSettings: sinon.stub().resolves(),
    setSetting: sinon.stub().resolves(),
    setAvailable: sinon.stub().resolves(),
    setUnavailable: sinon.stub().resolves(),
    log: sinon.stub(),
    error: sinon.stub(),
  };
  device.getSetting.withArgs('ip').returns('127.0.0.1');
  device.getSetting.withArgs('bacnetPort').returns(47808);
  device.getSetting.withArgs('serial').returns('800199-000001');
  device.getSetting.withArgs('filter_change_interval_months').returns(6);
  device.getSetting.withArgs('filter_change_interval_hours').returns(4380);
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

  it('resets filter timer with Flexit GO compatible AV:285 write first', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    mockClient.writeProperty.resetHistory();
    await registry.resetFilterTimer('test_unit');

    const { args } = mockClient.writeProperty.firstCall;
    expect(args[1]).to.deep.equal({ type: 2, instance: 285 });
    expect(args[3][0].type).to.equal(4); // REAL
    expect(args[3][0].value).to.equal(0);
    expect(args[4].priority).to.equal(16);
  });

  it('fails reset when Flexit GO AV:285 write fails (no fallback writes)', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    mockClient.writeProperty.resetBehavior();
    mockClient.writeProperty.onFirstCall().callsFake(
      (_ip: string, _objectId: { type: number; instance: number }, _propertyId: number, _value: any, _options: any, cb: any) => {
        cb(new Error('Write failed'));
      },
    );
    let thrown: Error | null = null;
    try {
      await registry.resetFilterTimer('test_unit');
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).to.not.equal(null);
    expect(thrown?.message).to.equal('Failed to reset filter timer via AV:285');
    const objectIds = mockClient.writeProperty.getCalls().map((call: any) => call.args[1]);
    expect(objectIds).to.deep.equal([{ type: 2, instance: 285 }]);
  });

  it('writes filter change interval and verifies unit-reported value', async () => {
    const mockDevice = makeMockDevice();
    mockClient.readPropertyMultiple.resetBehavior();
    mockClient.readPropertyMultiple.callsFake((_ip: string, _req: any[], cb: any) => {
      cb(null, {
        values: [
          makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_VALUE, 286, 5000),
        ],
      });
    });

    registry.register('test_unit', mockDevice);
    await registry.setFilterChangeInterval('test_unit', 5000);

    const writeCall = mockClient.writeProperty.getCalls().find((call: any) => (
      call.args[1].type === BACNET_ENUMS.ObjectType.ANALOG_VALUE && call.args[1].instance === 286
    ));
    expect(writeCall).to.not.equal(undefined);
    expect(writeCall?.args[3][0].type).to.equal(BACNET_ENUMS.ApplicationTags.REAL);
    expect(writeCall?.args[3][0].value).to.equal(5000);
    expect(writeCall?.args[4].priority).to.equal(16);

    const settingsUpdate = mockDevice.setSettings.getCalls().find((call: any) => (
      call.args[0]?.filter_change_interval_hours === 5000
      && call.args[0]?.filter_change_interval_months === Math.round(5000 / FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH)
    ));
    expect(settingsUpdate).to.not.equal(undefined);
  });

  it('writes mode fan profile with priority 16 and verifies values', async () => {
    const mockDevice = makeMockDevice();
    mockDevice.getSetting.withArgs('fan_profile_home_supply').returns(80);
    mockDevice.getSetting.withArgs('fan_profile_home_exhaust').returns(79);
    mockClient.readPropertyMultiple.resetBehavior();
    mockClient.readPropertyMultiple.callsFake((_ip: string, req: any[], cb: any) => {
      const requestedObjects = req
        .map((entry) => `${entry?.objectId?.type}:${entry?.objectId?.instance}`)
        .sort()
        .join(',');
      if (requestedObjects === '2:1836,2:1841') {
        cb(null, {
          values: [
            makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_VALUE, 1836, 70),
            makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_VALUE, 1841, 60),
          ],
        });
        return;
      }
      cb(null, { values: [] });
    });

    registry.register('test_unit', mockDevice);
    await registry.setFanProfileMode('test_unit', 'home', 70, 60);

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const homeSupply = callsByObject.get(JSON.stringify({ type: 2, instance: 1836 })) as any[] | undefined;
    const homeExhaust = callsByObject.get(JSON.stringify({ type: 2, instance: 1841 })) as any[] | undefined;

    expect(homeSupply).to.not.equal(undefined);
    expect(homeExhaust).to.not.equal(undefined);
    if (!homeSupply || !homeExhaust) throw new Error('Expected writes for home fan profile');

    expect(homeSupply[3][0].type).to.equal(BACNET_ENUMS.ApplicationTags.REAL);
    expect(homeSupply[3][0].value).to.equal(70);
    expect(homeSupply[4].priority).to.equal(16);
    expect(homeExhaust[3][0].type).to.equal(BACNET_ENUMS.ApplicationTags.REAL);
    expect(homeExhaust[3][0].value).to.equal(60);
    expect(homeExhaust[4].priority).to.equal(16);

    const verificationRead = mockClient.readPropertyMultiple.getCalls().find((call: any) => {
      const request = call.args[1] as any[];
      const requestedObjects = request
        .map((entry) => `${entry?.objectId?.type}:${entry?.objectId?.instance}`)
        .sort()
        .join(',');
      return requestedObjects === '2:1836,2:1841';
    });
    expect(verificationRead).to.not.equal(undefined);

    const settingsUpdate = mockDevice.setSettings.getCalls().find((call: any) => (
      call.args[0]?.fan_profile_home_supply === 70
      && call.args[0]?.fan_profile_home_exhaust === 60
    ));
    expect(settingsUpdate).to.not.equal(undefined);
  });

  it('rejects fan profile values outside mode-specific ranges', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    let thrown: Error | null = null;
    try {
      await registry.setFanProfileMode('test_unit', 'high', 70, 90);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).to.not.equal(null);
    expect(thrown?.message).to.equal('high supply fan profile must be between 80 and 100 percent');
    expect(mockClient.writeProperty.called).to.equal(false);
  });

  it('publishes current fan setpoint capabilities and triggers change callback', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const events: Array<{ fan: string; mode: string; setpointPercent: number }> = [];
    registry.setFanSetpointChangedHandler((event: any) => {
      events.push({
        fan: event.fan,
        mode: event.mode,
        setpointPercent: event.setpointPercent,
      });
    });

    const unit = (registry as any).units.get('test_unit');
    if (!unit) throw new Error('Expected unit to exist');

    (registry as any).distributeData(unit, {
      operation_mode: 3, // home
      ventilation_mode: 3, // home
      'fan_profile.home.supply': 80,
      'fan_profile.home.exhaust': 79,
    });

    expect(mockDevice.setCapabilityValue.calledWith('measure_fan_setpoint_percent', 80)).to.equal(true);
    expect(mockDevice.setCapabilityValue.calledWith('measure_fan_setpoint_percent.extract', 79)).to.equal(true);
    expect(events).to.have.length(0);

    (registry as any).distributeData(unit, {
      operation_mode: 3, // home
      ventilation_mode: 3, // home
      'fan_profile.home.supply': 81,
      'fan_profile.home.exhaust': 79,
    });

    expect(events.some((event) => (
      event.fan === 'supply' && event.mode === 'home' && event.setpointPercent === 81
    ))).to.equal(true);
  });

  it('uses cooker profile for current setpoint when operation mode is cooker hood', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    if (!unit) throw new Error('Expected unit to exist');

    (registry as any).distributeData(unit, {
      operation_mode: 5, // cooker hood
      ventilation_mode: 4, // high
      'fan_profile.high.supply': 100,
      'fan_profile.high.exhaust': 99,
      'fan_profile.cooker.supply': 90,
      'fan_profile.cooker.exhaust': 50,
    });

    expect(mockDevice.setCapabilityValue.calledWith('measure_fan_setpoint_percent', 90)).to.equal(true);
    expect(mockDevice.setCapabilityValue.calledWith('measure_fan_setpoint_percent.extract', 50)).to.equal(true);
  });

  it('fails filter interval write when AV:286 write fails (no fallback priorities)', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    mockClient.writeProperty.resetBehavior();
    mockClient.writeProperty.onFirstCall().callsFake(
      (_ip: string, _objectId: { type: number; instance: number }, _propertyId: number, _value: any, _options: any, cb: any) => {
        cb(new Error('Write failed'));
      },
    );

    let thrown: Error | null = null;
    try {
      await registry.setFilterChangeInterval('test_unit', 5000);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).to.not.equal(null);
    expect(thrown?.message).to.equal('Failed to write filter change interval via AV:286');
    expect(mockClient.writeProperty.callCount).to.equal(1);
    expect(mockClient.writeProperty.firstCall.args[1]).to.deep.equal({ type: 2, instance: 286 });
    expect(mockClient.writeProperty.firstCall.args[4].priority).to.equal(16);
  });

  it('rejects filter interval values outside 3..12 month equivalent hours', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    let lowError: Error | null = null;
    try {
      await registry.setFilterChangeInterval('test_unit', MIN_FILTER_CHANGE_INTERVAL_HOURS - 1);
    } catch (error) {
      lowError = error as Error;
    }
    let highError: Error | null = null;
    try {
      await registry.setFilterChangeInterval('test_unit', MAX_FILTER_CHANGE_INTERVAL_HOURS + 1);
    } catch (error) {
      highError = error as Error;
    }

    expect(lowError).to.not.equal(null);
    expect(highError).to.not.equal(null);
    expect(lowError?.message).to.equal(`Filter change interval must be between ${MIN_FILTER_CHANGE_INTERVAL_HOURS} and ${MAX_FILTER_CHANGE_INTERVAL_HOURS} hours`);
    expect(highError?.message).to.equal(`Filter change interval must be between ${MIN_FILTER_CHANGE_INTERVAL_HOURS} and ${MAX_FILTER_CHANGE_INTERVAL_HOURS} hours`);
    expect(mockClient.writeProperty.called).to.equal(false);
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
    expect(comfort[4].priority).to.equal(13);
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
    expect(comfort[4].priority).to.equal(13);
    expect(runtime[3][0].type).to.equal(2); // UNSIGNED_INTEGER
    expect(runtime[3][0].value).to.equal(10);
    expect(runtime[4].priority).to.equal(13);
    expect(trigger[3][0].type).to.equal(2); // UNSIGNED_INTEGER
    expect(trigger[3][0].value).to.equal(2);
    expect(trigger[4].priority).to.equal(13);
  });

  it('uses priority 13 for all writes when clearing active fireplace/rapid on away', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.probeValues.set('5:400', 1); // fireplace_active
    unit.probeValues.set('5:15', 1); // rapid_active

    await registry.setFanMode('test_unit', 'away');

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    expect(calls.length).to.be.greaterThan(0);

    for (const args of calls) {
      expect(args[4].priority).to.equal(13);
    }

    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));
    const fireplaceTrigger = callsByObject.get(JSON.stringify({ type: 19, instance: 360 })) as any[] | undefined;
    const rapidTrigger = callsByObject.get(JSON.stringify({ type: 19, instance: 357 })) as any[] | undefined;
    expect(fireplaceTrigger).to.not.equal(undefined);
    expect(rapidTrigger).to.not.equal(undefined);
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

  it('prefers operation mode over ventilation mode when both are present', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = { unitId: 'test_unit', devices: new Set([mockDevice]) };
    (registry as any).distributeData(unit, {
      operation_mode: 3, // home
      ventilation_mode: 2, // away
    });

    const call = mockDevice.setCapabilityValue.lastCall;
    expect(call.args[0]).to.equal('fan_mode');
    expect(call.args[1]).to.equal('home');
  });

  it('uses operation-mode profile for current setpoint when ventilation disagrees', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    if (!unit) throw new Error('Expected unit to exist');

    (registry as any).distributeData(unit, {
      operation_mode: 3, // home
      ventilation_mode: 2, // away
      'fan_profile.home.supply': 81,
      'fan_profile.home.exhaust': 80,
      'fan_profile.away.supply': 60,
      'fan_profile.away.exhaust': 59,
    });

    expect(mockDevice.setCapabilityValue.calledWith('measure_fan_setpoint_percent', 81)).to.equal(true);
    expect(mockDevice.setCapabilityValue.calledWith('measure_fan_setpoint_percent.extract', 80)).to.equal(true);
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

  it('uses unit-reported filter limit for filter life calculation', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = { unitId: 'test_unit', devices: new Set([mockDevice]) };
    (registry as any).distributeData(unit, {
      filter_time: 1000,
      filter_limit: 4380,
    });

    const filterLifeCalls = mockDevice.setCapabilityValue
      .getCalls()
      .filter((call: any) => call.args[0] === 'measure_hepa_filter');

    expect(filterLifeCalls.length).to.be.greaterThan(0);
    const lastCall = filterLifeCalls[filterLifeCalls.length - 1];
    expect(lastCall.args[1]).to.equal(77.2);
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
