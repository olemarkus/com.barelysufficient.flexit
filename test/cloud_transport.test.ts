/* eslint-disable import/extensions */
import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';
import { sleep } from './test_utils.ts';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { UnitRegistry } = require('../lib/UnitRegistry.ts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  FlexitCloudClient,
  AuthenticationError,
  bacnetObjectToCloudPath,
  cloudPathToBacnetObject,
} = require('../lib/flexitCloudClient.ts');

const PLANT_ID = 'TEST_PLANT_001';
const UNIT_ID = PLANT_ID;

const FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH = 732;
const DEFAULT_FAN_SETTINGS: Record<string, number> = {
  fan_profile_home_supply: 80,
  fan_profile_home_exhaust: 79,
  fan_profile_away_supply: 56,
  fan_profile_away_exhaust: 55,
  fan_profile_high_supply: 100,
  fan_profile_high_exhaust: 99,
  fan_profile_fireplace_supply: 90,
  fan_profile_fireplace_exhaust: 50,
  fan_profile_cooker_supply: 90,
  fan_profile_cooker_exhaust: 50,
};
const DEFAULT_TARGET_TEMPERATURE_SETTINGS: Record<string, number> = {
  target_temperature_home: 20,
  target_temperature_away: 18,
};

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/**
 * Build a mock cloud sensor response in the format returned by the Flexit cloud API.
 */
function buildCloudSensorResponse(
  plantId: string,
  values: Array<{ type: number; instance: number; value: number }>,
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const { type, instance, value } of values) {
    const path = bacnetObjectToCloudPath(type, instance);
    result[`${plantId}${path}`] = {
      value: {
        value,
        statusFlags: 0,
        reliability: 0,
        eventState: 0,
      },
    };
  }
  return result;
}

/** BACnet object type constants (matching bacstack enums). */
const OBJ = {
  ANALOG_INPUT: 0,
  ANALOG_OUTPUT: 1,
  ANALOG_VALUE: 2,
  BINARY_VALUE: 5,
  MULTI_STATE_VALUE: 19,
  POSITIVE_INTEGER_VALUE: 48,
};

/**
 * A standard set of sensor values simulating a Flexit unit in HOME mode.
 */
function defaultSensorValues(): Array<{ type: number; instance: number; value: number }> {
  return [
    // Temperatures
    { type: OBJ.ANALOG_VALUE, instance: 1994, value: 20 }, // home setpoint
    { type: OBJ.ANALOG_VALUE, instance: 1985, value: 18 }, // away setpoint
    { type: OBJ.ANALOG_INPUT, instance: 4, value: 21.5 }, // supply temp
    { type: OBJ.ANALOG_INPUT, instance: 1, value: 5.2 }, // outdoor temp
    { type: OBJ.ANALOG_INPUT, instance: 11, value: 22.0 }, // exhaust temp
    { type: OBJ.ANALOG_INPUT, instance: 59, value: 23.1 }, // extract temp primary
    { type: OBJ.ANALOG_INPUT, instance: 96, value: 45 }, // humidity
    { type: OBJ.ANALOG_VALUE, instance: 194, value: 0.5 }, // heater power (kW)
    { type: OBJ.BINARY_VALUE, instance: 445, value: 1 }, // heating coil on

    // Fan
    { type: OBJ.ANALOG_INPUT, instance: 5, value: 1200 }, // supply RPM
    { type: OBJ.ANALOG_INPUT, instance: 12, value: 1180 }, // extract RPM
    { type: OBJ.ANALOG_OUTPUT, instance: 3, value: 75 }, // supply fan %
    { type: OBJ.ANALOG_OUTPUT, instance: 4, value: 74 }, // extract fan %

    // Fan profiles
    { type: OBJ.ANALOG_VALUE, instance: 1836, value: 80 }, // home supply
    { type: OBJ.ANALOG_VALUE, instance: 1841, value: 79 }, // home exhaust
    { type: OBJ.ANALOG_VALUE, instance: 1837, value: 56 }, // away supply
    { type: OBJ.ANALOG_VALUE, instance: 1842, value: 55 }, // away exhaust
    { type: OBJ.ANALOG_VALUE, instance: 1835, value: 100 }, // high supply
    { type: OBJ.ANALOG_VALUE, instance: 1840, value: 99 }, // high exhaust
    { type: OBJ.ANALOG_VALUE, instance: 1838, value: 90 }, // fireplace supply
    { type: OBJ.ANALOG_VALUE, instance: 1843, value: 50 }, // fireplace exhaust
    { type: OBJ.ANALOG_VALUE, instance: 1839, value: 90 }, // cooker supply
    { type: OBJ.ANALOG_VALUE, instance: 1844, value: 50 }, // cooker exhaust

    // Filter
    { type: OBJ.ANALOG_VALUE, instance: 285, value: 1000 }, // operating time
    { type: OBJ.ANALOG_VALUE, instance: 286, value: 4392 }, // filter limit (6 months)

    // Mode
    { type: OBJ.BINARY_VALUE, instance: 50, value: 1 }, // comfort button (home)
    { type: OBJ.MULTI_STATE_VALUE, instance: 42, value: 3 }, // ventilation mode: HOME
    { type: OBJ.MULTI_STATE_VALUE, instance: 361, value: 3 }, // operation mode: HOME

    // Dehumidification
    { type: OBJ.ANALOG_VALUE, instance: 1870, value: 0 }, // dehumidification fan control
    { type: OBJ.BINARY_VALUE, instance: 653, value: 0 }, // dehumidification slope request

    // Fireplace / rapid
    { type: OBJ.POSITIVE_INTEGER_VALUE, instance: 270, value: 10 }, // fireplace runtime
    { type: OBJ.BINARY_VALUE, instance: 15, value: 0 }, // rapid active
    { type: OBJ.BINARY_VALUE, instance: 400, value: 0 }, // fireplace state
    { type: OBJ.ANALOG_VALUE, instance: 2005, value: 0 }, // remaining temp vent
    { type: OBJ.ANALOG_VALUE, instance: 2031, value: 0 }, // rapid remaining
    { type: OBJ.ANALOG_VALUE, instance: 2038, value: 0 }, // fireplace remaining
    { type: OBJ.ANALOG_VALUE, instance: 2125, value: 0 }, // mode RF input
  ];
}

function makeMockCloudClient(options: {
  sensorValues?: Array<{ type: number; instance: number; value: number }>;
  writeSuccess?: boolean;
  authFails?: boolean;
}) {
  const sensorValues = options.sensorValues ?? defaultSensorValues();

  const client = {
    authenticate: sinon.stub(),
    findPlants: sinon.stub().resolves([
      {
        id: PLANT_ID, name: 'Test Plant', serialNumber: '123456', isOnline: true,
      },
    ]),
    readDatapoints: sinon.stub().callsFake(
      async (plantId: string, _paths: string[]) => buildCloudSensorResponse(plantId, sensorValues),
    ),
    writeDatapoint: sinon.stub().resolves(options.writeSuccess ?? true),
    hasValidToken: sinon.stub().returns(true),
    restoreToken: sinon.stub(),
    getToken: sinon.stub().returns(null),
    destroy: sinon.stub(),
  };

  if (options.authFails) {
    client.authenticate.rejects(new Error('Authentication failed'));
  } else {
    client.authenticate.resolves({
      accessToken: 'test-token',
      expiresAt: Date.now() + 86_400_000,
    });
  }

  return client;
}

function makeMockDevice(filterIntervalHours: number = 4392) {
  let currentFilterIntervalHours = filterIntervalHours;
  let currentFilterIntervalMonths = Math.max(
    1,
    Math.round(filterIntervalHours / FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH),
  );
  let currentFireplaceDurationMinutes = 10;
  const currentFanSettings = { ...DEFAULT_FAN_SETTINGS };
  const currentTargetTemperatureSettings = { ...DEFAULT_TARGET_TEMPERATURE_SETTINGS };
  const getSetting = sinon.stub();
  getSetting.withArgs('plantId').returns(PLANT_ID);
  getSetting.withArgs('filter_change_interval_hours').callsFake(() => currentFilterIntervalHours);
  getSetting.withArgs('filter_change_interval_months').callsFake(() => currentFilterIntervalMonths);
  getSetting.withArgs('fireplace_duration_minutes').callsFake(() => currentFireplaceDurationMinutes);
  getSetting.callsFake((key: string) => {
    if (Object.prototype.hasOwnProperty.call(currentFanSettings, key)) return currentFanSettings[key];
    if (Object.prototype.hasOwnProperty.call(currentTargetTemperatureSettings, key)) {
      return currentTargetTemperatureSettings[key];
    }
    return undefined;
  });

  const setSettings = sinon.stub().callsFake(async (settings: Record<string, any>) => {
    const nextHours = settings?.filter_change_interval_hours;
    const nextMonths = settings?.filter_change_interval_months;
    if (typeof nextHours === 'number' && Number.isFinite(nextHours)) {
      currentFilterIntervalHours = nextHours;
      currentFilterIntervalMonths = Math.max(
        1,
        Math.round(nextHours / FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH),
      );
    }
    if (typeof nextMonths === 'number' && Number.isFinite(nextMonths)) {
      currentFilterIntervalMonths = nextMonths;
    }
    const nextFireplace = settings?.fireplace_duration_minutes;
    if (typeof nextFireplace === 'number') currentFireplaceDurationMinutes = nextFireplace;
    for (const [key, value] of Object.entries(settings)) {
      if (Object.prototype.hasOwnProperty.call(currentFanSettings, key)) {
        currentFanSettings[key] = value as number;
      }
      if (Object.prototype.hasOwnProperty.call(currentTargetTemperatureSettings, key)) {
        currentTargetTemperatureSettings[key] = value as number;
      }
    }
  });

  const capabilityValues: Record<string, any> = {};

  return {
    device: {
      getData: () => ({ unitId: UNIT_ID }),
      getSetting,
      setSettings,
      applyRegistrySettings: setSettings,
      setCapabilityValue: sinon.stub().callsFake(async (cap: string, value: any) => {
        capabilityValues[cap] = value;
      }),
      setAvailable: sinon.stub().resolves(),
      setUnavailable: sinon.stub().resolves(),
      log: sinon.stub(),
      error: sinon.stub(),
    },
    capabilityValues,
    getSetting,
    setSettings,
  };
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('Cloud transport – path encoding', () => {
  it('encodes AI:1 correctly', () => {
    expect(bacnetObjectToCloudPath(0, 1)).to.equal(';1!000000001000055');
  });

  it('encodes AV:1994 correctly', () => {
    expect(bacnetObjectToCloudPath(2, 1994)).to.equal(';1!0020007CA000055');
  });

  it('encodes BV:445 correctly', () => {
    expect(bacnetObjectToCloudPath(5, 445)).to.equal(';1!0050001BD000055');
  });

  it('encodes MSV:361 correctly', () => {
    expect(bacnetObjectToCloudPath(19, 361)).to.equal(';1!013000169000055');
  });

  it('encodes PIV:270 correctly', () => {
    expect(bacnetObjectToCloudPath(48, 270)).to.equal(';1!03000010E000055');
  });

  it('decodes cloud path to BACnet object', () => {
    const result = cloudPathToBacnetObject(';1!0020007CA000055');
    expect(result).to.deep.equal({ type: 2, instance: 1994 });
  });

  it('round-trips encode/decode', () => {
    const cases = [
      { type: 0, instance: 1 },
      { type: 2, instance: 1994 },
      { type: 5, instance: 445 },
      { type: 19, instance: 361 },
      { type: 48, instance: 270 },
    ];
    for (const { type, instance } of cases) {
      const path = bacnetObjectToCloudPath(type, instance);
      const decoded = cloudPathToBacnetObject(path);
      expect(decoded).to.deep.equal({ type, instance });
    }
  });
});

describe('Cloud transport – UnitRegistry integration', () => {
  let registry: InstanceType<typeof UnitRegistry>;
  let mockClient: ReturnType<typeof makeMockCloudClient>;
  let mock: ReturnType<typeof makeMockDevice>;

  beforeEach(() => {
    registry = new UnitRegistry({
      // Provide dummy BACnet deps so constructor doesn't fail
      getBacnetClient: () => ({}),
      discoverFlexitUnits: async () => [],
    });
    registry.setLogger({
      log: () => {},
      error: () => {},
      warn: () => {},
    });

    mockClient = makeMockCloudClient({});
    mock = makeMockDevice();
  });

  afterEach(() => {
    registry.destroy();
  });

  it('registers a cloud unit and starts polling', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });

    // Wait for async cloud poll to complete
    await sleep(100);

    expect(mockClient.readDatapoints.callCount).to.be.greaterThanOrEqual(1);
  });

  it('populates capabilities from cloud poll', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });

    await sleep(100);

    // Check that capabilities were set
    expect(mock.device.setCapabilityValue.called).to.equal(true);
    expect(mock.capabilityValues['measure_temperature']).to.equal(21.5);
    expect(mock.capabilityValues['measure_temperature.outdoor']).to.equal(5.2);
    expect(mock.capabilityValues['measure_temperature.exhaust']).to.equal(22.0);
    expect(mock.capabilityValues['measure_temperature.extract']).to.equal(23.1);
    expect(mock.capabilityValues['measure_humidity']).to.equal(45);
    expect(mock.capabilityValues['measure_motor_rpm']).to.equal(1200);
    expect(mock.capabilityValues['measure_motor_rpm.extract']).to.equal(1180);
    expect(mock.capabilityValues['measure_fan_speed_percent']).to.equal(75);
    expect(mock.capabilityValues['measure_fan_speed_percent.extract']).to.equal(74);
    expect(mock.capabilityValues['target_temperature']).to.equal(20);
    expect(mock.capabilityValues['fan_mode']).to.equal('home');
    // heater power is value * 1000 (kW -> W)
    expect(mock.capabilityValues['measure_power']).to.equal(500);
  });

  it('writes temperature setpoint via cloud', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(50);

    await registry.writeSetpoint(UNIT_ID, 22);

    expect(mockClient.writeDatapoint.called).to.equal(true);
    const [plantId, path, value] = mockClient.writeDatapoint.firstCall.args;
    expect(plantId).to.equal(PLANT_ID);
    // Should write to home setpoint (AV:1994) since mode is HOME
    expect(path).to.equal(bacnetObjectToCloudPath(2, 1994));
    expect(value).to.equal(22);
  });

  it('writes fan mode via cloud', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(50);

    await registry.setFanMode(UNIT_ID, 'away');

    expect(mockClient.writeDatapoint.called).to.equal(true);
    const [plantId, path, value] = mockClient.writeDatapoint.firstCall.args;
    expect(plantId).to.equal(PLANT_ID);
    // away mode writes to comfort button (BV:50) = 0
    expect(path).to.equal(bacnetObjectToCloudPath(5, 50));
    expect(value).to.equal(0);
  });

  it('writes fan mode home via cloud', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(50);

    await registry.setFanMode(UNIT_ID, 'home');

    // home mode first sets comfort button (BV:50) = 1, then ventilation mode (MSV:42) = 3
    const calls = mockClient.writeDatapoint.getCalls();
    const comfortCall = calls.find(
      (c: any) => c.args[1] === bacnetObjectToCloudPath(5, 50) && c.args[2] === 1,
    );
    const ventCall = calls.find(
      (c: any) => c.args[1] === bacnetObjectToCloudPath(19, 42) && c.args[2] === 3,
    );
    expect(comfortCall).to.not.equal(undefined);
    expect(ventCall).to.not.equal(undefined);
  });

  it('writes fan mode fireplace via cloud', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(50);

    await registry.setFanMode(UNIT_ID, 'fireplace');

    // fireplace writes comfort button, runtime, then trigger (MSV:360) = 2
    const calls = mockClient.writeDatapoint.getCalls();
    const triggerCall = calls.find(
      (c: any) => c.args[1] === bacnetObjectToCloudPath(19, 360) && c.args[2] === 2,
    );
    expect(triggerCall).to.not.equal(undefined);
  });

  it('resets filter timer via cloud', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(50);

    await registry.resetFilterTimer(UNIT_ID);

    const [, path, value] = mockClient.writeDatapoint.firstCall.args;
    // filter reset writes 0 to AV:285
    expect(path).to.equal(bacnetObjectToCloudPath(2, 285));
    expect(value).to.equal(0);
  });

  it('sets fan profile mode via cloud', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(50);

    await registry.setFanProfileMode(UNIT_ID, 'home', 70, 69);

    // Should have written supply and exhaust
    expect(mockClient.writeDatapoint.callCount).to.be.greaterThanOrEqual(2);
    const supplyCall = mockClient.writeDatapoint.getCall(0);
    const exhaustCall = mockClient.writeDatapoint.getCall(1);
    // home supply = AV:1836, home exhaust = AV:1841
    expect(supplyCall.args[1]).to.equal(bacnetObjectToCloudPath(2, 1836));
    expect(supplyCall.args[2]).to.equal(70);
    expect(exhaustCall.args[1]).to.equal(bacnetObjectToCloudPath(2, 1841));
    expect(exhaustCall.args[2]).to.equal(69);
  });

  it('sets heating coil via cloud', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(50);

    await registry.setHeatingCoilEnabled(UNIT_ID, false);

    const [, path, value] = mockClient.writeDatapoint.firstCall.args;
    // heating coil = BV:445
    expect(path).to.equal(bacnetObjectToCloudPath(5, 445));
    expect(value).to.equal(0);
  });

  it('marks device unavailable after consecutive cloud poll failures', async () => {
    const failingClient = makeMockCloudClient({});
    failingClient.readDatapoints.rejects(new Error('Network error'));

    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: failingClient,
    });

    // First poll (from registerCloud) fails
    await sleep(50);
    expect(mock.device.setUnavailable.called).to.equal(false);

    // Trigger additional poll failures to reach MAX_CONSECUTIVE_FAILURES (3)
    (registry as any).pollUnit(UNIT_ID);
    await sleep(50);
    (registry as any).pollUnit(UNIT_ID);
    await sleep(50);

    expect(mock.device.setUnavailable.called).to.equal(true);
    expect(mock.device.setUnavailable.firstCall.args[0]).to.include('Cloud connection lost');
  });

  it('handles cloud write failure gracefully', async () => {
    const failingClient = makeMockCloudClient({ writeSuccess: false });

    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: failingClient,
    });
    await sleep(50);

    try {
      await registry.writeSetpoint(UNIT_ID, 22);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).to.include('Failed to write');
    }
  });

  it('detects change in dehumidification state', async () => {
    const dehumidificationHandler = sinon.stub();
    registry.setDehumidificationStateChangedHandler(dehumidificationHandler);

    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(100);

    // First poll initializes state (dehumidification = false)
    // Now change to active
    const activeValues = defaultSensorValues().map((v) => {
      if (v.type === OBJ.ANALOG_VALUE && v.instance === 1870) {
        return { ...v, value: 50 }; // positive fan control demand
      }
      return v;
    });
    mockClient.readDatapoints.callsFake(
      async (plantId: string) => buildCloudSensorResponse(plantId, activeValues),
    );

    // Trigger another poll by calling the internal cloud poll via a write
    // We need to wait for the next poll cycle or trigger manually
    // For testing, let's call writeSetpoint which triggers a poll after write
    await registry.writeSetpoint(UNIT_ID, 20);
    await sleep(100);

    // The dehumidification state change handler must have been called
    expect(dehumidificationHandler.called).to.equal(true);
    expect(dehumidificationHandler.firstCall.args[0].active).to.equal(true);
  });

  it('computes filter life correctly from cloud data', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(100);

    // filter_time = 1000, filter_limit = 4392
    // life = (1 - 1000/4392) * 100 ≈ 77.2%
    const filterLife = mock.capabilityValues['measure_hepa_filter'];
    expect(filterLife).to.be.a('number');
    expect(filterLife).to.be.closeTo(77.2, 0.5);
  });

  it('syncs fan profile settings from cloud poll', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(100);

    // After first poll, settings should be synced from the cloud data
    // The mock device starts with default settings that match, so no sync needed
    // Let's change the cloud values and poll again
    const updatedValues = defaultSensorValues().map((v) => {
      if (v.type === OBJ.ANALOG_VALUE && v.instance === 1836) {
        return { ...v, value: 70 }; // home supply changed
      }
      return v;
    });
    mockClient.readDatapoints.callsFake(
      async (plantId: string) => buildCloudSensorResponse(plantId, updatedValues),
    );

    // Trigger another poll via a write
    await registry.writeSetpoint(UNIT_ID, 20);
    await sleep(100);

    // Check that setSettings was called with the new fan profile value
    const settingsCalls = mock.setSettings.getCalls();
    const hasUpdatedFanSetting = settingsCalls.some(
      (call: any) => call.args[0]?.fan_profile_home_supply === 70,
    );
    expect(hasUpdatedFanSetting).to.equal(true);
  });

  it('writes fan mode cooker via cloud', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(50);

    await registry.setFanMode(UNIT_ID, 'cooker');

    const [, path, value] = mockClient.writeDatapoint.firstCall.args;
    // cooker writes to cookerHood (BV:402) = 1
    expect(path).to.equal(bacnetObjectToCloudPath(5, 402));
    expect(value).to.equal(1);
  });

  it('uses cloud-specific unavailable message on poll failure, not BACnet rediscovery', async () => {
    const failingClient = makeMockCloudClient({});
    failingClient.readDatapoints.rejects(new Error('Network error'));

    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: failingClient,
    });

    // Trigger enough failures to mark unavailable
    await sleep(50);
    (registry as any).pollUnit(UNIT_ID);
    await sleep(50);
    (registry as any).pollUnit(UNIT_ID);
    await sleep(50);

    expect(mock.device.setUnavailable.called).to.equal(true);
    const message = mock.device.setUnavailable.firstCall.args[0];
    // Should be a cloud-specific message, not BACnet "will auto-reconnect when found"
    expect(message).to.include('Cloud');
    expect(message).to.not.include('auto-reconnect');
  });

  it('does not run concurrent cloud polls', async () => {
    let pollResolve: (() => void) | undefined;
    const slowClient = makeMockCloudClient({});
    slowClient.readDatapoints.callsFake(
      () => new Promise((resolve) => {
        pollResolve = () => resolve(buildCloudSensorResponse(PLANT_ID, defaultSensorValues()));
      }),
    );

    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: slowClient,
    });
    await sleep(10);

    // First poll is still in flight
    expect(slowClient.readDatapoints.callCount).to.equal(1);

    // Trigger another poll while first is in progress
    (registry as any).pollUnit(UNIT_ID);
    await sleep(10);

    // Second poll should have been skipped
    expect(slowClient.readDatapoints.callCount).to.equal(1);

    // Resolve the first poll
    pollResolve!();
    await sleep(50);
  });

  it('destroys duplicate client when registering second device to existing cloud unit', () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });

    const otherClient = makeMockCloudClient({});
    const otherMock = makeMockDevice();
    registry.registerCloud(UNIT_ID, otherMock.device, {
      plantId: PLANT_ID,
      client: otherClient,
    });
    // The duplicate client should be destroyed to avoid leaks
    expect(otherClient.destroy.called).to.equal(true);
  });

  it('throws when registering cloud unit with mismatched plantId', () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });

    const otherClient = makeMockCloudClient({});
    const otherMock = makeMockDevice();
    try {
      registry.registerCloud(UNIT_ID, otherMock.device, {
        plantId: 'DIFFERENT_PLANT',
        client: otherClient,
      });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).to.include('plantId');
    }
  });

  it('sets unit unavailable on auth failure during cloud poll', async () => {
    const authFailClient = makeMockCloudClient({});
    const { AuthenticationError: AuthErr } = require('../lib/flexitCloudClient.ts');
    authFailClient.readDatapoints.rejects(new AuthErr('Token expired'));

    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: authFailClient,
    });
    await sleep(50);

    expect(mock.device.setUnavailable.called).to.equal(true);
    expect(mock.device.setUnavailable.firstCall.args[0]).to.include('repair');
  });

  it('unregisters cloud device cleanly', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(50);

    registry.unregister(UNIT_ID, mock.device);
    expect(mockClient.destroy.called).to.equal(true);
  });

  it('stops poll interval on auth failure during cloud poll', async () => {
    const { AuthenticationError: AuthErr } = require('../lib/flexitCloudClient.ts');
    const authFailClient = makeMockCloudClient({});
    authFailClient.readDatapoints.rejects(new AuthErr('Token expired'));

    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: authFailClient,
    });
    await sleep(50);

    // Auth failure should have cleared the poll interval
    const unit = (registry as any).units.get(UNIT_ID);
    expect(unit.pollInterval).to.equal(null);
  });

  it('hasCloudUnit returns false for unknown unit and true for registered unit', () => {
    expect(registry.hasCloudUnit(UNIT_ID)).to.equal(false);

    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });

    expect(registry.hasCloudUnit(UNIT_ID)).to.equal(true);
  });

  it('restoreCloudAuth restores polling after auth failure', async () => {
    const { AuthenticationError: AuthErr } = require('../lib/flexitCloudClient.ts');
    const client = makeMockCloudClient({});
    client.readDatapoints.rejects(new AuthErr('Token expired'));

    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client,
    });
    await sleep(50);

    // Device should be unavailable with polling stopped
    expect(mock.device.setUnavailable.called).to.equal(true);
    const unit = (registry as any).units.get(UNIT_ID);
    expect(unit.pollInterval).to.equal(null);

    // Now restore auth with a fresh token and make reads succeed again
    client.readDatapoints.resolves({});
    const newToken = {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: Date.now() + 86400000,
    };
    registry.restoreCloudAuth(UNIT_ID, newToken);
    await sleep(50);

    expect(client.restoreToken.calledWith(newToken)).to.equal(true);
    expect(mock.device.setAvailable.called).to.equal(true);
    expect(unit.pollInterval).to.not.equal(null);
  });

  it('restoreCloudAuth preserves existing refresh token when new token has null', async () => {
    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: mockClient,
    });
    await sleep(50);

    // Simulate the client already having a refresh token
    mockClient.getToken.returns({
      accessToken: 'old-access',
      refreshToken: 'existing-refresh',
      expiresAt: Date.now() + 86400000,
    });

    const tokenWithoutRefresh = {
      accessToken: 'new-access',
      refreshToken: null,
      expiresAt: Date.now() + 86400000,
    };
    registry.restoreCloudAuth(UNIT_ID, tokenWithoutRefresh);

    const restored = mockClient.restoreToken.lastCall.args[0];
    expect(restored.accessToken).to.equal('new-access');
    expect(restored.refreshToken).to.equal('existing-refresh');
  });

  it('propagates AuthenticationError from cloud write', async () => {
    const { AuthenticationError: AuthErr } = require('../lib/flexitCloudClient.ts');
    const authFailClient = makeMockCloudClient({});
    // readDatapoints succeeds for initial poll, but writeDatapoint throws auth error
    authFailClient.writeDatapoint.rejects(new AuthErr('Token expired'));

    registry.registerCloud(UNIT_ID, mock.device, {
      plantId: PLANT_ID,
      client: authFailClient,
    });
    await sleep(50);

    try {
      await registry.writeSetpoint(UNIT_ID, 22);
      expect.fail('Should have thrown AuthenticationError');
    } catch (err: any) {
      expect(err.name).to.equal('AuthenticationError');
    }
  });
});

describe('Cloud transport – FlexitCloudClient', () => {
  let fetchStub: sinon.SinonStub;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchStub = sinon.stub();
    globalThis.fetch = fetchStub as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchResponse(body: any, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => body,
    };
  }

  it('authenticates with password and receives refresh token', async () => {
    fetchStub.resolves(mockFetchResponse({
      access_token: 'my-token',
      token_type: 'bearer',
      expires_in: 172799,
      refresh_token: 'my-refresh-token',
      userName: 'test@example.com',
      '.issued': 'Mon, 01 Jan 2024 00:00:00 GMT',
      '.expires': 'Wed, 03 Jan 2024 00:00:00 GMT',
    }));

    const client = new FlexitCloudClient();
    const token = await client.authenticateWithPassword('test@example.com', 'secret');

    expect(token.accessToken).to.equal('my-token');
    expect(token.refreshToken).to.equal('my-refresh-token');
    expect(token.expiresAt).to.be.a('number');
    expect(client.hasValidToken()).to.equal(true);

    // Verify the request includes include_refresh_token
    expect(fetchStub.calledOnce).to.equal(true);
    const [url, options] = fetchStub.firstCall.args;
    expect(url).to.include('/Token');
    expect(options.method).to.equal('POST');
    expect(options.body).to.include('grant_type=password');
    expect(options.body).to.include('include_refresh_token=true');
    expect(options.body).to.include('username=test%40example.com');
  });

  it('authenticates with refresh token', async () => {
    fetchStub.resolves(mockFetchResponse({
      access_token: 'new-access',
      token_type: 'bearer',
      expires_in: 172799,
      refresh_token: 'new-refresh',
    }));

    const client = new FlexitCloudClient();
    const token = await client.authenticateWithRefreshToken('old-refresh');

    expect(token.accessToken).to.equal('new-access');
    expect(token.refreshToken).to.equal('new-refresh');
    expect(client.hasValidToken()).to.equal(true);

    const [, options] = fetchStub.firstCall.args;
    expect(options.body).to.include('grant_type=refresh_token');
    expect(options.body).to.include('refresh_token=old-refresh');
    expect(options.body).to.include('include_refresh_token=true');
  });

  it('throws AuthenticationError when refresh token is invalid (400)', async () => {
    fetchStub.resolves(mockFetchResponse({ error: 'invalid_grant' }, 400));

    const client = new FlexitCloudClient();
    try {
      await client.authenticateWithRefreshToken('bad-token');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.be.an.instanceOf(AuthenticationError);
      expect(err.message).to.include('Refresh token authentication failed');
    }
  });

  it('throws AuthenticationError when refresh returns 401', async () => {
    fetchStub.resolves(mockFetchResponse({ error: 'unauthorized' }, 401));

    const client = new FlexitCloudClient();
    try {
      await client.authenticateWithRefreshToken('bad-token');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.be.an.instanceOf(AuthenticationError);
    }
  });

  it('throws plain Error (not AuthenticationError) for transient refresh failures', async () => {
    fetchStub.resolves(mockFetchResponse({}, 503));

    const client = new FlexitCloudClient();
    try {
      await client.authenticateWithRefreshToken('good-token');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.not.be.an.instanceOf(AuthenticationError);
      expect(err.message).to.include('503');
    }
  });

  it('notifies on token refresh via callback', async () => {
    fetchStub.resolves(mockFetchResponse({
      access_token: 'tok',
      expires_in: 172799,
      refresh_token: 'ref',
    }));

    const client = new FlexitCloudClient();
    const callback = sinon.stub();
    client.onTokenRefreshed(callback);

    await client.authenticateWithPassword('user', 'pass');

    expect(callback.calledOnce).to.equal(true);
    expect(callback.firstCall.args[0].accessToken).to.equal('tok');
    expect(callback.firstCall.args[0].refreshToken).to.equal('ref');
  });

  it('restores token and uses it for API calls', async () => {
    // Only plants call expected (no auth call since token is valid)
    fetchStub.resolves(mockFetchResponse({
      totalCount: 1,
      items: [{
        id: 'PLANT_123',
        name: 'My Unit',
        serialNumber: '800131-123456',
        isOnline: 'True',
      }],
    }));

    const client = new FlexitCloudClient();
    client.restoreToken({
      accessToken: 'restored-token',
      refreshToken: 'stored-refresh',
      expiresAt: Date.now() + 86_400_000,
    });

    const plants = await client.findPlants();

    expect(plants).to.have.lengthOf(1);
    expect(plants[0].id).to.equal('PLANT_123');
    // Should not have made an auth call
    expect(fetchStub.calledOnce).to.equal(true);
    const [, options] = fetchStub.firstCall.args;
    expect(options.headers.Authorization).to.equal('Bearer restored-token');
  });

  it('reads datapoints', async () => {
    fetchStub.resolves(mockFetchResponse({
      totalCount: 1,
      values: {
        'PLANT_123;1!000000004000055': {
          value: { value: 21.5, statusFlags: 0 },
        },
      },
    }));

    const client = new FlexitCloudClient();
    client.restoreToken({
      accessToken: 'token',
      refreshToken: 'ref',
      expiresAt: Date.now() + 86_400_000,
    });
    const values = await client.readDatapoints('PLANT_123', [';1!000000004000055']);

    expect(values['PLANT_123;1!000000004000055']).to.not.equal(undefined);
    expect(values['PLANT_123;1!000000004000055'].value.value).to.equal(21.5);
  });

  it('writes datapoint', async () => {
    fetchStub.resolves(mockFetchResponse({
      stateTexts: { 'PLANT_123;1!0020007CA000055': 'Success' },
    }));

    const client = new FlexitCloudClient();
    client.restoreToken({
      accessToken: 'token',
      refreshToken: 'ref',
      expiresAt: Date.now() + 86_400_000,
    });
    const success = await client.writeDatapoint('PLANT_123', ';1!0020007CA000055', 22);

    expect(success).to.equal(true);

    const [url, options] = fetchStub.firstCall.args;
    expect(url).to.include('/DataPoints/');
    expect(options.method).to.equal('PUT');
    const body = JSON.parse(options.body);
    expect(body.Value).to.equal('22');
  });

  it('handles write failure', async () => {
    fetchStub.resolves(mockFetchResponse({
      stateTexts: { 'PLANT_123;1!0020007CA000055': 'Error' },
    }));

    const client = new FlexitCloudClient();
    client.restoreToken({
      accessToken: 'token',
      refreshToken: 'ref',
      expiresAt: Date.now() + 86_400_000,
    });
    const success = await client.writeDatapoint('PLANT_123', ';1!0020007CA000055', 22);

    expect(success).to.equal(false);
  });

  it('handles HTTP error on password auth', async () => {
    fetchStub.resolves(mockFetchResponse({}, 401));

    const client = new FlexitCloudClient();
    try {
      await client.authenticateWithPassword('user', 'wrong-pass');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).to.include('401');
    }
  });

  it('refreshes token via refresh_token grant when expired', async () => {
    // Refresh token call
    fetchStub.onFirstCall().resolves(mockFetchResponse({
      access_token: 'token-2',
      expires_in: 172799,
      refresh_token: 'new-refresh',
    }));
    // Plants request with new token
    fetchStub.onSecondCall().resolves(mockFetchResponse({
      totalCount: 0,
      items: [],
    }));

    const client = new FlexitCloudClient();
    client.restoreToken({
      accessToken: 'token-1',
      refreshToken: 'old-refresh',
      expiresAt: 0, // already expired
    });

    expect(client.hasValidToken()).to.equal(false);

    // Next request should trigger refresh_token grant, not password grant
    await client.findPlants();

    expect(fetchStub.callCount).to.equal(2);
    const [, authOptions] = fetchStub.firstCall.args;
    expect(authOptions.body).to.include('grant_type=refresh_token');
    expect(authOptions.body).to.include('refresh_token=old-refresh');
  });

  it('throws AuthenticationError when token expired and no refresh token', async () => {
    const client = new FlexitCloudClient();
    client.restoreToken({
      accessToken: 'expired',
      refreshToken: null,
      expiresAt: 0,
    });

    try {
      await client.findPlants();
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.be.an.instanceOf(AuthenticationError);
      expect(err.message).to.include('no refresh token');
    }
  });

  it('throws AuthenticationError when no token at all', async () => {
    const client = new FlexitCloudClient();

    try {
      await client.findPlants();
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.be.an.instanceOf(AuthenticationError);
      expect(err.message).to.include('No token');
    }
  });

  it('getToken returns a copy of the current token', async () => {
    fetchStub.resolves(mockFetchResponse({
      access_token: 'tok',
      expires_in: 172799,
      refresh_token: 'ref',
    }));

    const client = new FlexitCloudClient();
    expect(client.getToken()).to.equal(null);

    await client.authenticateWithPassword('u', 'p');
    const token = client.getToken();
    expect(token).to.not.equal(null);
    expect(token!.accessToken).to.equal('tok');
    expect(token!.refreshToken).to.equal('ref');
  });

  it('destroy clears token and callback', () => {
    const client = new FlexitCloudClient();
    client.restoreToken({
      accessToken: 'tok',
      refreshToken: 'ref',
      expiresAt: Date.now() + 86_400_000,
    });
    client.destroy();
    expect(client.hasValidToken()).to.equal(false);
    expect(client.getToken()).to.equal(null);
  });

  it('passes abort signal to fetch', async () => {
    fetchStub.resolves(mockFetchResponse({
      access_token: 'tok',
      token_type: 'bearer',
      expires_in: 172799,
      refresh_token: 'ref',
    }));

    const client = new FlexitCloudClient();
    await client.authenticateWithPassword('user', 'pass');

    // Verify that fetch was called with a signal option
    const callArgs = fetchStub.firstCall.args;
    expect(callArgs[1]).to.have.property('signal');
    expect(callArgs[1].signal).to.be.instanceOf(AbortSignal);
  });
});
