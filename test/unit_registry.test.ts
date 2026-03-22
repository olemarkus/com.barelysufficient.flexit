import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

const FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH = 732;
const MIN_FILTER_CHANGE_INTERVAL_HOURS = 3 * FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH;
const MAX_FILTER_CHANGE_INTERVAL_HOURS = 12 * FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH;
const TEST_WRITE_TIMEOUT_MS = 5000;

function makeMockDevice(opts: {
  unitId?: string;
  settings?: Record<string, unknown>;
} = {}) {
  const settings: Record<string, unknown> = {
    ip: '127.0.0.1',
    bacnetPort: 47808,
    serial: '800199-000001',
    filter_change_interval_months: 6,
    filter_change_interval_hours: 4380,
    target_temperature_home: 20,
    target_temperature_away: 18,
    fireplace_duration_minutes: 10,
    ...(opts.settings ?? {}),
  };

  const applySettings = async (updates: Record<string, unknown>) => {
    Object.assign(settings, updates ?? {});
  };

  return {
    settings,
    getSetting: sinon.stub().callsFake((key: string) => settings[key]),
    getData: sinon.stub().returns({ unitId: opts.unitId ?? 'test_unit' }),
    setCapabilityValue: sinon.stub().resolves(),
    setSettings: sinon.stub().callsFake(applySettings),
    setSetting: sinon.stub().callsFake(applySettings),
    setAvailable: sinon.stub().resolves(),
    setUnavailable: sinon.stub().resolves(),
    log: sinon.stub(),
    error: sinon.stub(),
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

const BACNET_ENUMS = {
  ApplicationTags: {
    NULL: 0,
    REAL: 4,
    ENUMERATED: 9,
    UNSIGNED_INTEGER: 2,
  },
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
    registry = new UnitRegistryClass({
      writeTimeoutMs: TEST_WRITE_TIMEOUT_MS,
    });
  });

  afterEach(() => {
    registry.destroy();
  });

  it('writes away mode via BV:50 with priority 13', async () => {
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

  it('writes heating coil enable/disable via BV:445 with priority 13', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    await registry.setHeatingCoilEnabled('test_unit', false);

    const disableWrite = mockClient.writeProperty.firstCall.args;
    expect(disableWrite[1]).to.deep.equal({ type: 5, instance: 445 });
    expect(disableWrite[3][0].type).to.equal(BACNET_ENUMS.ApplicationTags.ENUMERATED);
    expect(disableWrite[3][0].value).to.equal(0);
    expect(disableWrite[4].priority).to.equal(13);

    mockClient.writeProperty.resetHistory();
    await registry.setHeatingCoilEnabled('test_unit', true);

    const enableWrite = mockClient.writeProperty.firstCall.args;
    expect(enableWrite[1]).to.deep.equal({ type: 5, instance: 445 });
    expect(enableWrite[3][0].type).to.equal(BACNET_ENUMS.ApplicationTags.ENUMERATED);
    expect(enableWrite[3][0].value).to.equal(1);
    expect(enableWrite[4].priority).to.equal(13);
  });

  it('reads heating coil state from BV:445', async () => {
    const mockDevice = makeMockDevice();
    mockClient.readPropertyMultiple.resetBehavior();
    mockClient.readPropertyMultiple.callsFake((_ip: string, request: any[], cb: any) => {
      const requestedObjects = request
        .map((entry) => `${entry?.objectId?.type}:${entry?.objectId?.instance}`)
        .sort()
        .join(',');
      if (requestedObjects === '5:445') {
        cb(null, { values: [makeReadObject(BACNET_ENUMS.ObjectType.BINARY_VALUE, 445, 1)] });
        return;
      }
      cb(null, { values: [] });
    });

    registry.register('test_unit', mockDevice);
    const enabled = await registry.getHeatingCoilEnabled('test_unit');

    expect(enabled).to.equal(true);
    const readCall = mockClient.readPropertyMultiple.getCalls().find((call: any) => {
      const request = call.args[1] as any[];
      const requestedObjects = request
        .map((entry) => `${entry?.objectId?.type}:${entry?.objectId?.instance}`)
        .sort()
        .join(',');
      return requestedObjects === '5:445';
    });
    expect(readCall).to.not.equal(undefined);
  });

  it('toggles heating coil state via BV:445', async () => {
    const mockDevice = makeMockDevice();
    mockClient.readPropertyMultiple.resetBehavior();
    mockClient.readPropertyMultiple.callsFake((_ip: string, request: any[], cb: any) => {
      const requestedObjects = request
        .map((entry) => `${entry?.objectId?.type}:${entry?.objectId?.instance}`)
        .sort()
        .join(',');
      if (requestedObjects === '5:445') {
        cb(null, { values: [makeReadObject(BACNET_ENUMS.ObjectType.BINARY_VALUE, 445, 1)] });
        return;
      }
      cb(null, { values: [] });
    });

    registry.register('test_unit', mockDevice);
    const nextState = await registry.toggleHeatingCoilEnabled('test_unit');

    expect(nextState).to.equal(false);
    const writeArgs = mockClient.writeProperty.firstCall.args;
    expect(writeArgs[1]).to.deep.equal({ type: 5, instance: 445 });
    expect(writeArgs[3][0].type).to.equal(BACNET_ENUMS.ApplicationTags.ENUMERATED);
    expect(writeArgs[3][0].value).to.equal(0);
    expect(writeArgs[4].priority).to.equal(13);
  });

  it('emits heating coil state change callback on transitions', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const events: Array<{ enabled: boolean; device: any }> = [];
    registry.setHeatingCoilStateChangedHandler((event: any) => {
      events.push({ enabled: event.enabled, device: event.device });
    });

    const unit = (registry as any).units.get('test_unit');
    (registry as any).distributeData(unit, { heating_coil_enabled: 1 });
    (registry as any).distributeData(unit, { heating_coil_enabled: 0 });
    (registry as any).distributeData(unit, { heating_coil_enabled: 1 });

    expect(events).to.have.length(2);
    expect(events[0].enabled).to.equal(false);
    expect(events[1].enabled).to.equal(true);
    expect(events[0].device).to.equal(mockDevice);
    expect(events[1].device).to.equal(mockDevice);
  });

  it('emits dehumidification state change callback on transitions', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const events: Array<{ active: boolean; device: any }> = [];
    registry.setDehumidificationStateChangedHandler((event: any) => {
      events.push({ active: event.active, device: event.device });
    });

    const unit = (registry as any).units.get('test_unit');
    (registry as any).distributeData(unit, {
      dehumidification_fan_control: 100,
      dehumidification_request_by_slope: 1,
    });
    (registry as any).distributeData(unit, {
      dehumidification_fan_control: 0,
      dehumidification_request_by_slope: 0,
    });
    (registry as any).distributeData(unit, {
      dehumidification_fan_control: 100,
      dehumidification_request_by_slope: 0,
    });

    expect(events).to.have.length(2);
    expect(events[0].active).to.equal(false);
    expect(events[1].active).to.equal(true);
    expect(events[0].device).to.equal(mockDevice);
    expect(events[1].device).to.equal(mockDevice);
  });

  it('blocks further heating coil writes after unsupported object error (Code:31)', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    mockClient.writeProperty.resetBehavior();
    mockClient.writeProperty.onFirstCall().callsFake(
      (
        _ip: string,
        _objectId: { type: number; instance: number },
        _propertyId: number,
        _value: any,
        _options: any,
        cb: any,
      ) => {
        cb(new Error('Code:31 Unsupported object 5:445'));
      },
    );

    let firstError: Error | null = null;
    try {
      await registry.setHeatingCoilEnabled('test_unit', false);
    } catch (error) {
      firstError = error as Error;
    }
    expect(firstError).to.not.equal(null);
    expect(mockClient.writeProperty.callCount).to.equal(1);

    mockClient.writeProperty.resetHistory();
    let secondError: Error | null = null;
    try {
      await registry.setHeatingCoilEnabled('test_unit', false);
    } catch (error) {
      secondError = error as Error;
    }
    expect(secondError).to.not.equal(null);
    expect(mockClient.writeProperty.callCount).to.equal(0);
  });

  it('writes setpoint with BACnet priority 13', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    await registry.writeSetpoint('test_unit', 21.5);

    const { args } = mockClient.writeProperty.firstCall;
    expect(args[1]).to.deep.equal({ type: 2, instance: 1994 });
    expect(args[4].priority).to.equal(13);
  });

  it('skips setpoint write when probe value already matches', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    // Seed probe value for home setpoint (AV:1994) — key is "type:instance"
    unit.probeValues.set(`${BACNET_ENUMS.ObjectType.ANALOG_VALUE}:1994`, 21.5);

    await registry.writeSetpoint('test_unit', 21.5);

    expect(mockClient.writeProperty.called).to.equal(false);
  });

  it('writes setpoint to away object when unit is in away mode', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.probeValues.set('19:361', 2); // operation_mode away

    await registry.writeSetpoint('test_unit', 17.5);

    const { args } = mockClient.writeProperty.firstCall;
    expect(args[1]).to.deep.equal({ type: 2, instance: 1985 });
    expect(args[3][0].value).to.equal(17.5);
    expect(args[4].priority).to.equal(13);
  });

  it('recovers setpoint writes after a timed out queued write', async () => {
    const clock = sinon.useFakeTimers();
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    let writeCount = 0;
    mockClient.writeProperty.resetBehavior();
    mockClient.writeProperty.callsFake(
      (
        _ip: string,
        _objectId: { type: number; instance: number },
        _propertyId: number,
        _value: any,
        _options: any,
        cb: any,
      ) => {
        writeCount += 1;
        if (writeCount === 1) return;
        cb(null, {});
      },
    );

    try {
      const firstWrite = registry.writeSetpoint('test_unit', 21).then(
        () => ({ ok: true as const }),
        (error: Error) => ({ ok: false as const, error }),
      );

      await clock.tickAsync(TEST_WRITE_TIMEOUT_MS);

      const firstResult = await firstWrite;
      expect(firstResult.ok).to.equal(false);
      if (firstResult.ok) throw new Error('Expected timed out write to fail');
      expect(firstResult.error.message).to.equal('Timeout');

      await registry.writeSetpoint('test_unit', 22);

      expect(mockClient.writeProperty.callCount).to.equal(2);
      expect(mockClient.writeProperty.secondCall.args[3][0].value).to.equal(22);
    } finally {
      clock.restore();
    }
  });

  it('probes target temperature mode without fan-mode side effects', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.expectedMode = 'home';
    unit.probeValues.set('19:361', 2); // operation_mode away

    const logModeMismatchSpy = sinon.spy(registry as any, 'logModeMismatch');
    try {
      await registry.writeSetpoint('test_unit', 18);

      expect(logModeMismatchSpy.called).to.equal(false);
      const { args } = mockClient.writeProperty.firstCall;
      expect(args[1]).to.deep.equal({ type: 2, instance: 1985 });
    } finally {
      logModeMismatchSpy.restore();
    }
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
      (
        _ip: string,
        _objectId: { type: number; instance: number },
        _propertyId: number,
        _value: any,
        _options: any,
        cb: any,
      ) => {
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
    mockDevice.settings.fan_profile_home_supply = 80;
    mockDevice.settings.fan_profile_home_exhaust = 79;
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

    expect(mockDevice.setCapabilityValue.calledWith('fan_mode', 'cooker')).to.equal(true);
    expect(mockDevice.setCapabilityValue.calledWith('measure_fan_setpoint_percent', 90)).to.equal(true);
    expect(mockDevice.setCapabilityValue.calledWith('measure_fan_setpoint_percent.extract', 50)).to.equal(true);
  });

  it('uses away target temperature for main target capability in away mode', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    if (!unit) throw new Error('Expected unit to exist');

    (registry as any).distributeData(unit, {
      operation_mode: 2, // away
      ventilation_mode: 2, // away
      'target_temperature.home': 21,
      'target_temperature.away': 17,
    });

    expect(mockDevice.setCapabilityValue.calledWith('target_temperature', 17)).to.equal(true);
  });

  it('uses home target temperature for main target capability in high mode', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    if (!unit) throw new Error('Expected unit to exist');

    (registry as any).distributeData(unit, {
      operation_mode: 4, // high
      ventilation_mode: 4, // high
      'target_temperature.home': 22,
      'target_temperature.away': 16,
    });

    expect(mockDevice.setCapabilityValue.calledWith('target_temperature', 22)).to.equal(true);
  });

  it('normalizes active target temperature capability to 10..30 in 0.5C steps', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    if (!unit) throw new Error('Expected unit to exist');

    (registry as any).distributeData(unit, {
      operation_mode: 2, // away
      ventilation_mode: 2, // away
      'target_temperature.home': 31.2,
      'target_temperature.away': 9.74,
    });

    expect(mockDevice.setCapabilityValue.calledWith('target_temperature', 10)).to.equal(true);
  });

  it('normalizes synced home/away target temperature settings to 10..30 in 0.5C steps', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    if (!unit) throw new Error('Expected unit to exist');

    (registry as any).distributeData(unit, {
      operation_mode: 3, // home
      ventilation_mode: 3, // home
      'target_temperature.home': 31.2,
      'target_temperature.away': 9.74,
    });

    const settingsUpdate = mockDevice.setSettings.getCalls().find((call: any) => (
      call.args[0]?.target_temperature_home === 30
      && call.args[0]?.target_temperature_away === 10
    ));
    expect(settingsUpdate).to.not.equal(undefined);
  });

  it('fails filter interval write when AV:286 write fails (no fallback priorities)', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    mockClient.writeProperty.resetBehavior();
    mockClient.writeProperty.onFirstCall().callsFake(
      (
        _ip: string,
        _objectId: { type: number; instance: number },
        _propertyId: number,
        _value: any,
        _options: any,
        cb: any,
      ) => {
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
    expect(lowError?.message).to.equal(
      `Filter change interval must be between ${MIN_FILTER_CHANGE_INTERVAL_HOURS}`
      + ` and ${MAX_FILTER_CHANGE_INTERVAL_HOURS} hours`,
    );
    expect(highError?.message).to.equal(
      `Filter change interval must be between ${MIN_FILTER_CHANGE_INTERVAL_HOURS}`
      + ` and ${MAX_FILTER_CHANGE_INTERVAL_HOURS} hours`,
    );
    expect(mockClient.writeProperty.called).to.equal(false);
  });

  it('writes fireplace duration to PIV:270 with priority 13 and verifies the value', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    mockClient.readPropertyMultiple.resetBehavior();
    mockClient.readPropertyMultiple.callsFake((_ip: string, request: any[], cb: any) => {
      const requestedObjects = request
        .map((entry) => `${entry?.objectId?.type}:${entry?.objectId?.instance}`)
        .sort()
        .join(',');
      if (requestedObjects === '48:270') {
        cb(null, { values: [makeReadObject(BACNET_ENUMS.ObjectType.POSITIVE_INTEGER_VALUE, 270, 22)] });
        return;
      }
      cb(null, { values: [] });
    });

    await registry.setFireplaceVentilationDuration('test_unit', 22);

    const writeArgs = mockClient.writeProperty.firstCall.args;
    expect(writeArgs[1]).to.deep.equal({ type: 48, instance: 270 });
    expect(writeArgs[3][0].type).to.equal(BACNET_ENUMS.ApplicationTags.UNSIGNED_INTEGER);
    expect(writeArgs[3][0].value).to.equal(22);
    expect(writeArgs[4].priority).to.equal(13);
    expect(mockDevice.setSettings.calledWithMatch({ fireplace_duration_minutes: 22 })).to.equal(true);
  });

  it('rejects fireplace duration values outside 1..360 minutes', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    let lowError: Error | null = null;
    try {
      await registry.setFireplaceVentilationDuration('test_unit', 0);
    } catch (error) {
      lowError = error as Error;
    }
    let highError: Error | null = null;
    try {
      await registry.setFireplaceVentilationDuration('test_unit', 361);
    } catch (error) {
      highError = error as Error;
    }

    expect(lowError).to.not.equal(null);
    expect(highError).to.not.equal(null);
    expect(lowError?.message).to.equal('Fireplace duration must be between 1 and 360 minutes');
    expect(highError?.message).to.equal('Fireplace duration must be between 1 and 360 minutes');
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

  it('writes cooker hood mode via BV:402 with priority 13', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    await registry.setFanMode('test_unit', 'cooker');

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const cookerHood = callsByObject.get(JSON.stringify({ type: 5, instance: 402 })) as any[] | undefined;

    expect(cookerHood).to.not.equal(undefined);
    if (!cookerHood) throw new Error('Expected cooker hood write');

    expect(cookerHood[3][0].type).to.equal(9); // ENUMERATED
    expect(cookerHood[3][0].value).to.equal(1);
    expect(cookerHood[4].priority).to.equal(13);
  });

  it('clears cooker hood when switching away after a local cooker write before the next poll', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.lastPollAt = 100;
    unit.lastWriteValues.set('5:402', { value: 1, at: 200 });

    await registry.setFanMode('test_unit', 'away');

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const cookerHood = callsByObject.get(JSON.stringify({ type: 5, instance: 402 })) as any[] | undefined;
    const comfort = callsByObject.get(JSON.stringify({ type: 5, instance: 50 })) as any[] | undefined;

    expect(cookerHood).to.not.equal(undefined);
    expect(comfort).to.not.equal(undefined);
    if (!cookerHood || !comfort) throw new Error('Expected cooker hood clear and away write');

    expect(cookerHood[3][0].type).to.equal(BACNET_ENUMS.ApplicationTags.NULL);
    expect(cookerHood[3][0].value).to.equal(null);
    expect(cookerHood[4].priority).to.equal(13);
    expect(comfort[3][0].value).to.equal(0);
  });

  it('clears cooker hood before switching back to home mode', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.probeValues.set('19:361', 5); // operation_mode cooker hood

    await registry.setFanMode('test_unit', 'home');

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const cookerHood = callsByObject.get(JSON.stringify({ type: 5, instance: 402 })) as any[] | undefined;
    const comfort = callsByObject.get(JSON.stringify({ type: 5, instance: 50 })) as any[] | undefined;
    const ventilation = callsByObject.get(JSON.stringify({ type: 19, instance: 42 })) as any[] | undefined;

    expect(cookerHood).to.not.equal(undefined);
    expect(comfort).to.not.equal(undefined);
    expect(ventilation).to.not.equal(undefined);

    if (!cookerHood || !comfort || !ventilation) {
      throw new Error('Expected cooker hood clear and home mode writes');
    }

    expect(cookerHood[3][0].type).to.equal(BACNET_ENUMS.ApplicationTags.NULL);
    expect(cookerHood[3][0].value).to.equal(null);
    expect(cookerHood[4].priority).to.equal(13);
    expect(comfort[3][0].value).to.equal(1);
    expect(ventilation[3][0].value).to.equal(3);
  });

  it('cancels fireplace ventilation before switching fireplace back to home', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.probeValues.set('5:50', 1); // comfort_button home
    unit.probeValues.set('19:42', 4); // ventilation_mode high
    unit.probeValues.set('19:361', 6); // operation_mode fireplace
    unit.probeValues.set('5:400', 1); // fireplace_active
    unit.probeValues.set('2:2005', 8); // remaining_temp_vent_op

    await registry.setFanMode('test_unit', 'home');

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const ventilation = callsByObject.get(JSON.stringify({ type: 19, instance: 42 })) as any[] | undefined;
    const fireplaceTrigger = callsByObject.get(JSON.stringify({ type: 19, instance: 360 })) as any[] | undefined;
    const rapidTrigger = callsByObject.get(JSON.stringify({ type: 19, instance: 357 })) as any[] | undefined;
    const resetTempVentOp = callsByObject.get(JSON.stringify({ type: 5, instance: 452 })) as any[] | undefined;

    expect(ventilation).to.not.equal(undefined);
    expect(fireplaceTrigger).to.not.equal(undefined);
    expect(rapidTrigger).to.equal(undefined);
    expect(resetTempVentOp).to.equal(undefined);

    if (!fireplaceTrigger || !ventilation) {
      throw new Error('Expected fireplace trigger cancel and home mode writes');
    }

    expect(fireplaceTrigger[3][0].type).to.equal(BACNET_ENUMS.ApplicationTags.UNSIGNED_INTEGER);
    expect(fireplaceTrigger[3][0].value).to.equal(2);
    expect(fireplaceTrigger[4].priority).to.equal(13);
    expect(ventilation[3][0].value).to.equal(3);
  });

  it('cancels temporary high before switching back to home', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.probeValues.set('5:50', 1); // comfort_button home
    unit.probeValues.set('19:42', 4); // ventilation_mode high
    unit.probeValues.set('19:361', 7); // operation_mode temporary high
    unit.probeValues.set('5:15', 1); // rapid_active
    unit.probeValues.set('2:2005', 8); // remaining_temp_vent_op

    await registry.setFanMode('test_unit', 'home');

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const ventilation = callsByObject.get(JSON.stringify({ type: 19, instance: 42 })) as any[] | undefined;
    const rapidTrigger = callsByObject.get(JSON.stringify({ type: 19, instance: 357 })) as any[] | undefined;
    const resetTempVentOp = callsByObject.get(JSON.stringify({ type: 5, instance: 452 })) as any[] | undefined;

    expect(ventilation).to.not.equal(undefined);
    expect(rapidTrigger).to.not.equal(undefined);
    expect(resetTempVentOp).to.equal(undefined);

    if (!rapidTrigger || !ventilation) {
      throw new Error('Expected rapid trigger cancel and home mode writes');
    }

    expect(rapidTrigger[3][0].type).to.equal(BACNET_ENUMS.ApplicationTags.UNSIGNED_INTEGER);
    expect(rapidTrigger[3][0].value).to.equal(2);
    expect(rapidTrigger[4].priority).to.equal(13);
    expect(ventilation[3][0].value).to.equal(3);
  });

  it(
    'writes fireplace mode with runtime and fireplace trigger'
      + ' when no temporary high ventilation is active',
    async () => {
      const mockDevice = makeMockDevice();
      registry.register('test_unit', mockDevice);
      const unit = (registry as any).units.get('test_unit');
      unit.probeValues.set('48:270', 10);

      await registry.setFanMode('test_unit', 'fireplace');

      const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
      const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

      const comfort = callsByObject.get(JSON.stringify({ type: 5, instance: 50 })) as any[] | undefined;
      const runtime = callsByObject.get(JSON.stringify({ type: 48, instance: 270 })) as any[] | undefined;
      const rapidTrigger = callsByObject.get(JSON.stringify({ type: 19, instance: 357 })) as any[] | undefined;
      const fireplaceTrigger = callsByObject.get(JSON.stringify({ type: 19, instance: 360 })) as any[] | undefined;
      const resetTempVentOp = callsByObject.get(JSON.stringify({ type: 5, instance: 452 })) as any[] | undefined;

      expect(comfort).to.not.equal(undefined);
      expect(runtime).to.not.equal(undefined);
      expect(rapidTrigger).to.equal(undefined);
      expect(fireplaceTrigger).to.not.equal(undefined);
      expect(resetTempVentOp).to.equal(undefined);

      if (!runtime || !fireplaceTrigger || !comfort) {
        throw new Error('Expected comfort, runtime, and fireplace trigger writes');
      }

      expect(comfort[3][0].value).to.equal(1);
      expect(comfort[4].priority).to.equal(13);
      expect(runtime[3][0].type).to.equal(2); // UNSIGNED_INTEGER
      expect(runtime[3][0].value).to.equal(10);
      expect(runtime[4].priority).to.equal(13);
      expect(fireplaceTrigger[3][0].type).to.equal(2); // UNSIGNED_INTEGER
      expect(fireplaceTrigger[3][0].value).to.equal(2);
      expect(fireplaceTrigger[4].priority).to.equal(13);
    },
  );

  it('does not re-trigger fireplace mode when the unit already reports fireplace active', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.probeValues.set('5:400', 1); // fireplace_active
    unit.probeValues.set('19:361', 6); // operation_mode fireplace
    unit.expectedMode = 'away';
    unit.expectedModeAt = 1234;
    unit.lastMismatchKey = 'away->home';

    await registry.setFanMode('test_unit', 'fireplace');

    expect(mockClient.writeProperty.called).to.equal(false);
    expect(unit.expectedMode).to.equal('away');
    expect(unit.expectedModeAt).to.equal(1234);
    expect(unit.lastMismatchKey).to.equal('away->home');
  });

  it('does not warn about temporary ventilation when fireplace is already active', async () => {
    const mockDevice = makeMockDevice();
    const logger = {
      log: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
    registry.setLogger(logger);
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.probeValues.set('5:400', 1); // fireplace_active
    unit.probeValues.set('19:361', 6); // operation_mode fireplace
    unit.probeValues.set('2:2005', 9); // remaining_temp_vent_op

    await registry.setFanMode('test_unit', 'fireplace');

    expect(logger.warn.calledWithMatch('[UnitRegistry] Fireplace requested while temporary ventilation is active'))
      .to.equal(false);
  });

  it('suppresses stale mode mismatch logs briefly after a mode write', () => {
    const clock = sinon.useFakeTimers();
    try {
      const mockDevice = makeMockDevice();
      const logger = {
        log: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
      };
      registry.setLogger(logger);
      registry.register('test_unit', mockDevice);

      const unit = (registry as any).units.get('test_unit');
      unit.expectedMode = 'fireplace';
      unit.expectedModeAt = Date.now();

      (registry as any).distributeData(unit, {
        comfort_button: 1,
        ventilation_mode: 3,
        operation_mode: 3,
        rapid_active: 0,
        fireplace_active: 0,
        remaining_temp_vent_op: 0,
        remaining_rapid_vent: 354,
        remaining_fireplace_vent: 15,
        mode_rf_input: 24,
      });

      expect(logger.warn.calledWithMatch('[UnitRegistry] Mode mismatch')).to.equal(false);

      clock.tick(1001);
      (registry as any).distributeData(unit, {
        comfort_button: 1,
        ventilation_mode: 3,
        operation_mode: 3,
        rapid_active: 0,
        fireplace_active: 0,
        remaining_temp_vent_op: 0,
        remaining_rapid_vent: 354,
        remaining_fireplace_vent: 15,
        mode_rf_input: 24,
      });

      expect(logger.warn.calledWithMatch('[UnitRegistry] Mode mismatch')).to.equal(true);
    } finally {
      clock.restore();
    }
  });

  it('writes rapid then fireplace when switching temporary high to fireplace', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.probeValues.set('19:361', 7); // operation_mode temporary high
    unit.probeValues.set('5:15', 1); // rapid_active
    unit.probeValues.set('2:2005', 9); // remaining_temp_vent_op

    await registry.setFanMode('test_unit', 'fireplace');

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));

    const rapidTrigger = callsByObject.get(JSON.stringify({ type: 19, instance: 357 })) as any[] | undefined;
    const fireplaceTrigger = callsByObject.get(JSON.stringify({ type: 19, instance: 360 })) as any[] | undefined;

    expect(rapidTrigger).to.not.equal(undefined);
    expect(fireplaceTrigger).to.not.equal(undefined);
    expect(unit.deferredMode).to.equal(undefined);
    expect(unit.expectedMode).to.equal('fireplace');
  });

  it('uses priority 13 for fireplace cancel and away writes', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.probeValues.set('5:400', 1); // fireplace_active
    unit.probeValues.set('19:361', 6); // operation_mode fireplace
    unit.probeValues.set('2:2005', 8); // remaining_temp_vent_op

    await registry.setFanMode('test_unit', 'away');

    const calls = mockClient.writeProperty.getCalls().map((call: any) => call.args);
    expect(calls.length).to.be.greaterThan(0);

    for (const args of calls) {
      expect(args[4].priority).to.equal(13);
    }

    const callsByObject = new Map<string, any[]>(calls.map((args: any) => [JSON.stringify(args[1]), args]));
    const rapidTrigger = callsByObject.get(JSON.stringify({ type: 19, instance: 357 })) as any[] | undefined;
    const fireplaceTrigger = callsByObject.get(JSON.stringify({ type: 19, instance: 360 })) as any[] | undefined;
    expect(fireplaceTrigger).to.not.equal(undefined);
    expect(rapidTrigger).to.equal(undefined);
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

  it('prefers fireplace operation mode over rapid-active signal', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = { unitId: 'test_unit', devices: new Set([mockDevice]) };
    (registry as any).distributeData(unit, {
      comfort_button: 1,
      ventilation_mode: 3,
      operation_mode: 6,
      rapid_active: 1,
      fireplace_active: 0,
      remaining_temp_vent_op: 10,
    });

    const call = mockDevice.setCapabilityValue.lastCall;
    expect(call.args[0]).to.equal('fan_mode');
    expect(call.args[1]).to.equal('fireplace');
  });

  it('does not let stale fireplace countdown override temporary high', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = { unitId: 'test_unit', devices: new Set([mockDevice]) };
    (registry as any).distributeData(unit, {
      comfort_button: 1,
      ventilation_mode: 3,
      operation_mode: 7,
      rapid_active: 1,
      fireplace_active: 0,
      remaining_temp_vent_op: 10,
      remaining_rapid_vent: 9,
      remaining_fireplace_vent: 9,
    });

    const call = mockDevice.setCapabilityValue.lastCall;
    expect(call.args[0]).to.equal('fan_mode');
    expect(call.args[1]).to.equal('high');
  });

  it('prefers away comfort-button state over stale home operation mode', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = { unitId: 'test_unit', devices: new Set([mockDevice]) };
    (registry as any).distributeData(unit, {
      comfort_button: 0,
      operation_mode: 3, // stale home
      ventilation_mode: 3, // stale home
    });

    const call = mockDevice.setCapabilityValue.lastCall;
    expect(call.args[0]).to.equal('fan_mode');
    expect(call.args[1]).to.equal('away');
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

  it('writes away setpoint when comfort-button state says away despite stale home operation mode', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.probeValues.set('5:50', 0); // comfort_button away
    unit.probeValues.set('19:361', 3); // stale operation_mode home
    unit.probeValues.set('19:42', 3); // stale ventilation_mode home

    await registry.writeSetpoint('test_unit', 17.5);

    const { args } = mockClient.writeProperty.firstCall;
    expect(args[1]).to.deep.equal({ type: 2, instance: 1985 });
    expect(args[3][0].value).to.equal(17.5);
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

  it('publishes dehumidification capability from fan-control state', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = { unitId: 'test_unit', devices: new Set([mockDevice]) };
    (registry as any).distributeData(unit, {
      dehumidification_fan_control: 100,
      dehumidification_request_by_slope: 0,
    });

    expect(mockDevice.setCapabilityValue.calledWith('dehumidification_active', true)).to.equal(true);

    mockDevice.setCapabilityValue.resetHistory();
    (registry as any).distributeData(unit, {
      dehumidification_fan_control: 0,
      dehumidification_request_by_slope: 0,
    });

    expect(mockDevice.setCapabilityValue.calledWith('dehumidification_active', false)).to.equal(true);
  });

  it('falls back to slope request when dehumidification fan control is unavailable', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = { unitId: 'test_unit', devices: new Set([mockDevice]) };
    (registry as any).distributeData(unit, {
      dehumidification_request_by_slope: 1,
    });

    expect(mockDevice.setCapabilityValue.calledWith('dehumidification_active', true)).to.equal(true);
  });

  it('does not publish dehumidification capability when no dehumidification signals are available', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = { unitId: 'test_unit', devices: new Set([mockDevice]) };
    (registry as any).distributeData(unit, {
      measure_humidity: 34,
    });

    expect(mockDevice.setCapabilityValue.calledWith('dehumidification_active', sinon.match.any)).to.equal(false);
  });

  it('reads dehumidification state from BACnet before the first poll initializes it', async () => {
    const mockDevice = makeMockDevice();
    mockClient.readPropertyMultiple.resetBehavior();
    mockClient.readPropertyMultiple.callsFake((_ip: string, request: any[], cb: any) => {
      const requestedObjects = request
        .map((entry) => `${entry?.objectId?.type}:${entry?.objectId?.instance}`)
        .sort()
        .join(',');
      if (requestedObjects === '2:1870') {
        cb(null, { values: [makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_VALUE, 1870, 100)] });
        return;
      }
      if (requestedObjects === '5:653') {
        cb(null, { values: [makeReadObject(BACNET_ENUMS.ObjectType.BINARY_VALUE, 653, 1)] });
        return;
      }
      cb(null, { values: [] });
    });

    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.dehumidificationActive = undefined;
    unit.dehumidificationStateInitialized = false;
    unit.probeValues.delete('2:1870');
    unit.probeValues.delete('5:653');

    const active = await registry.getDehumidificationActive('test_unit');

    expect(active).to.equal(true);
    expect(unit.dehumidificationActive).to.equal(true);
    expect(unit.dehumidificationStateInitialized).to.equal(true);
  });

  it('returns cached dehumidification state when initialized', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.dehumidificationActive = true;
    unit.dehumidificationStateInitialized = true;

    mockClient.readPropertyMultiple.resetHistory();
    const active = await registry.getDehumidificationActive('test_unit');

    expect(active).to.equal(true);
    expect(mockClient.readPropertyMultiple.called).to.equal(false);
  });

  it('derives dehumidification state from cached probe values when needed', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.probeValues.set('2:1870', 100);
    unit.probeValues.set('5:653', 0);

    const active = await registry.getDehumidificationActive('test_unit');

    expect(active).to.equal(true);
    expect(unit.dehumidificationActive).to.equal(true);
    expect(unit.dehumidificationStateInitialized).to.equal(true);
  });

  it('throws when dehumidification state is unavailable', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    let thrown: Error | null = null;
    try {
      await registry.getDehumidificationActive('test_unit');
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).to.not.equal(null);
    expect(thrown?.message).to.equal('Dehumidification state unavailable');
  });

  it('marks BACnet device unavailable after 3 consecutive poll failures', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    (registry as any).handlePollFailure(unit);
    (registry as any).handlePollFailure(unit);
    expect(unit.available).to.equal(true);

    (registry as any).handlePollFailure(unit);
    expect(mockDevice.setUnavailable.calledOnce).to.equal(true);
    expect(unit.available).to.equal(false);
  });

  it('logs setUnavailable failures instead of swallowing them', async () => {
    const mockDevice = makeMockDevice();
    const failure = new Error('setUnavailable failed');
    mockDevice.setUnavailable.rejects(failure);
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.consecutiveFailures = 2;

    (registry as any).handlePollFailure(unit);
    await Promise.resolve();

    expect(mockDevice.error.calledWithExactly(
      '[UnitRegistry] Failed to set device unavailable for test_unit:',
      failure,
    )).to.equal(true);
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

  it('logs setAvailable failures instead of swallowing them', async () => {
    const mockDevice = makeMockDevice();
    const failure = new Error('setAvailable failed');
    mockDevice.setAvailable.rejects(failure);
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.available = false;

    (registry as any).handlePollSuccess(unit);
    await Promise.resolve();

    expect(mockDevice.error.calledWithExactly(
      '[UnitRegistry] Failed to set device available for test_unit:',
      failure,
    )).to.equal(true);
  });

  it('falls back to the default BACnet port when the stored setting is invalid', () => {
    const mockDevice = makeMockDevice({
      settings: {
        bacnetPort: 'not-a-port',
      },
    });

    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    expect(unit.bacnetPort).to.equal(47808);
    expect(getBacnetClientStub.calledWithExactly(47808)).to.equal(true);
  });

  it('persists rediscovered BACnet endpoint and reuses it on restart', async () => {
    const unitId = '800199000001';
    const mockDevice = makeMockDevice({
      unitId,
      settings: {
        serial: '800199-000001',
      },
    });
    registry.register(unitId, mockDevice);

    const unit = (registry as any).units.get(unitId);
    unit.available = false;
    mockClient.readPropertyMultiple.resetHistory();
    getBacnetClientStub.resetHistory();

    discoverStub.resolves([{
      name: 'Nordic Mock',
      serial: '800199-000001',
      serialNormalized: unitId,
      ip: '192.0.2.10',
      bacnetPort: 47809,
    }]);

    (registry as any).startRediscovery(unit);
    await flushAsyncWork();

    expect(unit.ip).to.equal('192.0.2.10');
    expect(unit.bacnetPort).to.equal(47809);
    expect(mockDevice.setSettings.calledWithMatch({
      ip: '192.0.2.10',
      bacnetPort: '47809',
    })).to.equal(true);
    expect(mockDevice.getSetting('ip')).to.equal('192.0.2.10');
    expect(mockDevice.getSetting('bacnetPort')).to.equal('47809');
    expect(getBacnetClientStub.calledWithExactly(47809)).to.equal(true);
    expect(mockClient.readPropertyMultiple.lastCall.args[0]).to.equal('192.0.2.10');
    expect(mockDevice.setAvailable.called).to.equal(true);

    const restartedRegistry = new UnitRegistryClass({
      getBacnetClient: getBacnetClientStub,
      discoverFlexitUnits: discoverStub,
      writeTimeoutMs: TEST_WRITE_TIMEOUT_MS,
    });

    try {
      mockClient.readPropertyMultiple.resetHistory();
      getBacnetClientStub.resetHistory();
      restartedRegistry.register(unitId, mockDevice);

      expect(getBacnetClientStub.calledWithExactly(47809)).to.equal(true);
      expect(mockClient.readPropertyMultiple.firstCall.args[0]).to.equal('192.0.2.10');
    } finally {
      restartedRegistry.destroy();
    }
  });

  it('ignores invalid rediscovered BACnet endpoints', async () => {
    const unitId = '800199000001';
    const mockDevice = makeMockDevice({
      unitId,
      settings: {
        serial: '800199-000001',
      },
    });
    const logger = {
      log: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
    registry.setLogger(logger);
    registry.register(unitId, mockDevice);

    const unit = (registry as any).units.get(unitId);
    unit.available = false;
    mockDevice.setSettings.resetHistory();
    mockClient.readPropertyMultiple.resetHistory();
    discoverStub.resolves([{
      name: 'Nordic Mock',
      serial: '800199-000001',
      serialNormalized: unitId,
      ip: '',
      bacnetPort: 'nope',
    }]);

    (registry as any).startRediscovery(unit);
    await flushAsyncWork();

    expect(unit.ip).to.equal('127.0.0.1');
    expect(unit.bacnetPort).to.equal(47808);
    expect(mockDevice.setSettings.called).to.equal(false);
    expect(mockClient.readPropertyMultiple.called).to.equal(false);
    expect(logger.warn.calledWithMatch(
      `[UnitRegistry] Ignoring invalid rediscovered endpoint for ${unitId}: <empty>:nope`,
    )).to.equal(true);
  });

  it('abandons stale poll and starts fresh when next interval fires', () => {
    const mockDevice = makeMockDevice();
    const callbacks: Array<(err: any, value: any) => void> = [];
    mockClient.readPropertyMultiple.resetBehavior();
    mockClient.readPropertyMultiple.callsFake((_ip: string, _requestArray: any[], cb: any) => {
      callbacks.push(cb);
    });

    registry.register('test_unit', mockDevice);
    expect(mockClient.readPropertyMultiple.callCount).to.equal(1);

    // Next interval fires while first poll is still in flight — abandons and starts new
    (registry as any).pollUnit('test_unit', true);
    expect(mockClient.readPropertyMultiple.callCount).to.equal(2);

    // Stale callback from first poll is ignored
    const unit = (registry as any).units.get('test_unit');
    callbacks[0](null, { values: [] });
    expect(unit.consecutiveFailures).to.equal(1);
  });

  it('marks BACnet device unavailable after consecutive poll failures', () => {
    const mockDevice = makeMockDevice();

    mockClient.readPropertyMultiple.resetBehavior();
    mockClient.readPropertyMultiple.callsFake(() => { /* never calls back */ });

    registry.register('test_unit', mockDevice);
    const unit = (registry as any).units.get('test_unit');
    mockDevice.setUnavailable.resetHistory();

    // register() started a poll that hangs. Each interval-driven pollUnit call
    // while in-flight abandons the old poll and counts a failure.
    (registry as any).pollUnit('test_unit', true); // failure 1
    (registry as any).pollUnit('test_unit', true); // failure 2
    (registry as any).pollUnit('test_unit', true); // failure 3 → unavailable

    expect(unit.consecutiveFailures).to.equal(3);
    expect(mockDevice.setUnavailable.calledOnce).to.equal(true);
    expect(unit.available).to.equal(false);
  });

  it('counts poll with missing values as a failure', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);
    const unit = (registry as any).units.get('test_unit');

    (registry as any).handlePollResponse(unit, {});

    expect(mockDevice.error.calledWithExactly(
      '[UnitRegistry] Poll response missing values for test_unit:',
      {},
    )).to.equal(true);
    expect(unit.consecutiveFailures).to.equal(1);
  });

  it('recovers polling when a poll callback never returns', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);
    const unit = (registry as any).units.get('test_unit');

    mockClient.readPropertyMultiple.resetHistory();
    mockClient.readPropertyMultiple.resetBehavior();
    let callCount = 0;
    mockClient.readPropertyMultiple.callsFake((_ip: string, _requestArray: any[], cb: any) => {
      callCount += 1;
      if (callCount === 1) return; // Simulate a hung BACnet client callback.
      cb(null, { values: [] });
    });

    (registry as any).pollUnit('test_unit', true);
    expect(unit.pollInFlight).to.equal(true);
    expect(mockClient.readPropertyMultiple.callCount).to.equal(1);

    // Next interval abandons the hung poll and starts a new one
    (registry as any).pollUnit('test_unit', true);
    expect(mockClient.readPropertyMultiple.callCount).to.equal(2);
    expect(unit.pollInFlight).to.equal(false);
    expect(unit.consecutiveFailures).to.equal(0); // success resets counter
  });

  it('ignores stale callback after poll generation advances', () => {
    const mockDevice = makeMockDevice();
    const callbacks: Array<(err: any, value: any) => void> = [];
    mockClient.readPropertyMultiple.resetBehavior();
    mockClient.readPropertyMultiple.callsFake((_ip: string, _requestArray: any[], cb: any) => {
      callbacks.push(cb);
    });

    registry.register('test_unit', mockDevice);
    const unit = (registry as any).units.get('test_unit');

    // Abandon first poll via next interval
    (registry as any).pollUnit('test_unit', true);
    expect(callbacks.length).to.equal(2);

    // Complete second poll successfully
    callbacks[1](null, { values: [] });
    expect(unit.consecutiveFailures).to.equal(0);

    // Stale first callback should be ignored
    mockDevice.setCapabilityValue.resetHistory();
    callbacks[0](null, { values: [] });
    expect(mockDevice.setCapabilityValue.called).to.equal(false);
  });

  it('clamps and rounds setpoint writes to valid 0.5C range', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    await registry.writeSetpoint('test_unit', 5);

    const { args } = mockClient.writeProperty.firstCall;
    expect(args[3][0].value).to.equal(10); // clamped to min

    mockClient.writeProperty.resetHistory();
    await registry.writeSetpoint('test_unit', 35);

    const args2 = mockClient.writeProperty.firstCall.args;
    expect(args2[3][0].value).to.equal(30); // clamped to max

    mockClient.writeProperty.resetHistory();
    await registry.writeSetpoint('test_unit', 21.26);

    const args3 = mockClient.writeProperty.firstCall.args;
    expect(args3[3][0].value).to.equal(21.5); // rounded to 0.5C step
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
    expect(objectIds).to.include('5:445');
  });

  it('maps exhaust air temperature from AI 11 to capability', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);
    const unit = (registry as any).units.get('test_unit');
    (registry as any).handlePollResponse(unit, {
      values: [
        makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_INPUT, 11, 2.1),
      ],
    });

    const exhaustTempCalls = mockDevice.setCapabilityValue
      .getCalls()
      .filter((call: any) => call.args[0] === 'measure_temperature.exhaust');

    expect(exhaustTempCalls.length).to.be.greaterThan(0);
    const lastCall = exhaustTempCalls[exhaustTempCalls.length - 1];
    expect(lastCall.args[1]).to.equal(2.1);
  });

  it('prefers extract air temperature from AI 59 when present', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);
    const unit = (registry as any).units.get('test_unit');
    (registry as any).handlePollResponse(unit, {
      values: [
        makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_INPUT, 59, 21.4),
        makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_INPUT, 95, 0),
      ],
    });

    const extractTempCalls = mockDevice.setCapabilityValue
      .getCalls()
      .filter((call: any) => call.args[0] === 'measure_temperature.extract');

    expect(extractTempCalls.length).to.be.greaterThan(0);
    const lastCall = extractTempCalls[extractTempCalls.length - 1];
    expect(lastCall.args[1]).to.equal(21.4);
  });

  it('falls back to extract air temperature from AI 95 when AI 59 is zero', () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);
    const unit = (registry as any).units.get('test_unit');
    (registry as any).handlePollResponse(unit, {
      values: [
        makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_INPUT, 59, 0),
        makeReadObject(BACNET_ENUMS.ObjectType.ANALOG_INPUT, 95, 20.8),
      ],
    });

    const extractTempCalls = mockDevice.setCapabilityValue
      .getCalls()
      .filter((call: any) => call.args[0] === 'measure_temperature.extract');

    expect(extractTempCalls.length).to.be.greaterThan(0);
    const lastCall = extractTempCalls[extractTempCalls.length - 1];
    expect(lastCall.args[1]).to.equal(20.8);
  });

  it('logs capability update failures instead of swallowing them', async () => {
    const mockDevice = makeMockDevice();
    const failure = new Error('setCapabilityValue failed');
    mockDevice.setCapabilityValue.rejects(failure);
    registry.register('test_unit', mockDevice);

    (registry as any).setCapability(mockDevice, 'measure_temperature', 21.5);
    await Promise.resolve();

    expect(mockDevice.error.calledWithExactly(
      "[UnitRegistry] Failed to set capability 'measure_temperature' for test_unit:",
      failure,
    )).to.equal(true);
  });

  it('does not read device data on successful capability updates', async () => {
    const mockDevice = makeMockDevice();
    mockDevice.getData.resetHistory();

    (registry as any).setCapability(mockDevice, 'measure_temperature', 21.5);
    await Promise.resolve();

    expect(mockDevice.getData.called).to.equal(false);
  });

  it('logs deferred fireplace retry failures instead of swallowing them', async () => {
    const mockDevice = makeMockDevice();
    registry.register('test_unit', mockDevice);

    const unit = (registry as any).units.get('test_unit');
    unit.deferredMode = 'fireplace';
    unit.deferredSince = Date.now();
    const failure = new Error('retry failed');
    const setFanModeStub = sinon.stub(registry, 'setFanMode').rejects(failure);

    try {
      (registry as any).resolveFanMode(unit, {
        comfort_button: 1,
        ventilation_mode: 3,
        operation_mode: 3,
        rapid_active: 0,
        fireplace_active: 0,
        remaining_temp_vent_op: 0,
        remaining_rapid_vent: 0,
        remaining_fireplace_vent: 0,
        mode_rf_input: 24,
      });
      await Promise.resolve();
    } finally {
      setFanModeStub.restore();
    }

    expect(mockDevice.error.calledWithExactly(
      '[UnitRegistry] Deferred fireplace retry failed for test_unit:',
      failure,
    )).to.equal(true);
  });
});
