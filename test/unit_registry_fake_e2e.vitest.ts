/* eslint-disable import/extensions */
import dgram from 'dgram';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sinon from 'sinon';
import { getFreePort, sleep } from './test_utils.ts';

import Bacnet from 'bacstack';
import { UnitRegistry } from '../lib/UnitRegistry.ts';
import { FakeBacnetServer } from '../scripts/fake-unit/bacnetServer.ts';
import { FakeNordicUnitState } from '../scripts/fake-unit/state.ts';
import {
  DEFAULT_DEVICE_NAME,
  DEFAULT_FIRMWARE,
  DEFAULT_MODEL_NAME,
  OBJECT_TYPE,
  OPERATION_MODE_VALUES,
  PROPERTY_ID,
  DEFAULT_VENDOR_ID,
  DEFAULT_VENDOR_NAME,
} from '../scripts/fake-unit/manifest.ts';

const CLIENT_BIND_ADDRESS = '127.0.0.1';
const SERVER_BIND_ADDRESS = '127.0.0.2';
const MOVED_SERVER_BIND_ADDRESS = '127.0.0.3';
const SOCKET_LISTEN_TIMEOUT_MS = 2000;
const SHORT_WRITE_TIMEOUT_MS = 300;
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
const DEFAULT_FREE_COOLING_SETTINGS: Record<string, number | boolean> = {
  free_cooling_enabled: false,
  free_cooling_extract_temp_setpoint: 22,
  free_cooling_outside_temp_limit: 18,
  free_cooling_min_on_time_seconds: 600,
};

function createState() {
  return new FakeNordicUnitState({
    identity: {
      deviceId: 2,
      serial: '800131-123456',
      modelName: DEFAULT_MODEL_NAME,
      deviceName: DEFAULT_DEVICE_NAME,
      firmware: DEFAULT_FIRMWARE,
      vendorName: DEFAULT_VENDOR_NAME,
      vendorId: DEFAULT_VENDOR_ID,
    },
    timeScale: 0.1,
  });
}

function makeMockDevice(serverIp: string, serverPort: number, filterIntervalHours: number) {
  const currentSettings: Record<string, any> = {
    ip: serverIp,
    bacnetPort: serverPort,
    serial: '800131-123456',
    filter_change_interval_hours: filterIntervalHours,
    filter_change_interval_months: Math.max(
      1,
      Math.round(filterIntervalHours / FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH),
    ),
    fireplace_duration_minutes: 10,
    ...DEFAULT_FAN_SETTINGS,
    ...DEFAULT_TARGET_TEMPERATURE_SETTINGS,
    ...DEFAULT_FREE_COOLING_SETTINGS,
  };

  const applySettings = async (settings: Record<string, any>) => {
    const nextHours = settings?.filter_change_interval_hours;
    const nextMonths = settings?.filter_change_interval_months;
    if (typeof nextHours === 'number' && Number.isFinite(nextHours)) {
      currentSettings.filter_change_interval_hours = nextHours;
      currentSettings.filter_change_interval_months = Math.max(
        1,
        Math.round(nextHours / FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH),
      );
    }
    if (
      typeof nextMonths === 'number'
      && Number.isFinite(nextMonths)
      && !(typeof nextHours === 'number' && Number.isFinite(nextHours))
    ) {
      currentSettings.filter_change_interval_months = nextMonths;
      currentSettings.filter_change_interval_hours = Math.round(
        nextMonths * FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH,
      );
    }
    const nextFireplaceDuration = settings?.fireplace_duration_minutes;
    if (typeof nextFireplaceDuration === 'number' && Number.isFinite(nextFireplaceDuration)) {
      currentSettings.fireplace_duration_minutes = Math.round(nextFireplaceDuration);
    }

    for (const [key, value] of Object.entries(settings ?? {})) {
      if (key === 'filter_change_interval_hours') continue;
      if (key === 'filter_change_interval_months') continue;
      if (key === 'fireplace_duration_minutes' && typeof value === 'number' && Number.isFinite(value)) continue;
      currentSettings[key] = value;
    }
  };

  return {
    getData: sinon.stub().returns({ unitId: 'test_unit' }),
    getSetting: sinon.stub().callsFake((key: string) => currentSettings[key]),
    setSettings: sinon.stub().callsFake(applySettings),
    setSetting: sinon.stub().callsFake(applySettings),
    setCapabilityValue: sinon.stub().resolves(),
    setAvailable: sinon.stub().resolves(),
    setUnavailable: sinon.stub().resolves(),
    log: sinon.stub(),
    error: sinon.stub(),
  };
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3000,
  intervalMs = 25,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function transportSocketFromClient(client: any) {
  return client?._transport?._server;
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return undefined;
}

function isRetryablePortError(error: unknown) {
  if (errorCode(error) === 'EADDRINUSE') return true;
  if (error instanceof Error && /UDP socket/i.test(error.message)) return true;
  return false;
}

async function waitForSocketListening(socket: dgram.Socket | null | undefined) {
  if (!socket) throw new Error('UDP socket was not created');
  if ((socket as any).listening) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('listening', onListening);
      socket.off('error', onError);
      reject(new Error('Timed out waiting for UDP socket to listen'));
    }, SOCKET_LISTEN_TIMEOUT_MS);

    function onListening() {
      clearTimeout(timeout);
      socket.off('error', onError);
      resolve();
    }

    function onError(error: unknown) {
      clearTimeout(timeout);
      socket.off('listening', onListening);
      reject(error);
    }

    socket.once('listening', onListening);
    socket.once('error', onError);
  });
}

async function canBindUdpPort(address: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const finish = (result: boolean) => {
      socket.removeAllListeners('error');
      socket.close(() => resolve(result));
    };

    socket.once('error', (error: any) => {
      if (errorCode(error) === 'EADDRINUSE') {
        finish(false);
        return;
      }
      finish(false);
    });

    socket.bind(port, address, () => finish(true));
  });
}

async function pickAvailablePort(maxAttempts = 20): Promise<number> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const port = await getFreePort();
    // Verify the same port can be bound independently by client and server addresses.
    if (!await canBindUdpPort(CLIENT_BIND_ADDRESS, port)) continue;
    if (!await canBindUdpPort(SERVER_BIND_ADDRESS, port)) continue;
    return port;
  }

  throw new Error(`Unable to find an available UDP port after ${maxAttempts} attempts`);
}

async function createHarnessOnPort(serverPort: number) {
  const state = createState();
  let server: any;
  let client: any;

  try {
    server = new FakeBacnetServer(state, {
      port: serverPort,
      bindAddress: SERVER_BIND_ADDRESS,
      advertiseAddress: SERVER_BIND_ADDRESS,
      logTraffic: false,
      periodicIAmMs: 0,
    });
    server.start();
    await waitForSocketListening(transportSocketFromClient((server as any).client));

    client = new Bacnet({
      port: serverPort,
      interface: CLIENT_BIND_ADDRESS,
      apduTimeout: 3000,
      apduSize: 1476,
    });

    // Avoid noisy test logs from async UDP errors, assertions validate behavior.
    client.on('error', () => { });
    await waitForSocketListening(transportSocketFromClient(client));
    await sleep(25);

    return {
      state,
      client,
      server,
      serverPort,
    };
  } catch (error) {
    client?.close();
    server?.stop();
    throw error;
  }
}

async function createServerOnAddress(state: any, serverPort: number, bindAddress: string) {
  const server = new FakeBacnetServer(state, {
    port: serverPort,
    bindAddress,
    advertiseAddress: bindAddress,
    logTraffic: false,
    periodicIAmMs: 0,
  });
  server.start();
  await waitForSocketListening(transportSocketFromClient((server as any).client));
  await sleep(25);
  return server;
}

async function createBacnetHarness() {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const serverPort = await pickAvailablePort();
    try {
      return await createHarnessOnPort(serverPort);
    } catch (error) {
      lastError = error;
      if (!isRetryablePortError(error)) throw error;
      await sleep(25);
    }
  }

  throw new Error(`Unable to create UDP BACnet harness after retries: ${String(lastError)}`);
}

describe('UnitRegistry fake-unit e2e', { timeout: 10000 }, () => {
  let registry: any;
  let state: any;
  let client: any;
  let server: any;
  let writePresentValueSpy: sinon.SinonSpy;
  let discoverFlexitUnitsStub: sinon.SinonStub;
  let getBacnetClientStub: sinon.SinonStub;
  let serverPort = 47808;

  beforeEach(async () => {
    const harness = await createBacnetHarness();
    state = harness.state;
    client = harness.client;
    server = harness.server;
    serverPort = harness.serverPort;
    writePresentValueSpy = sinon.spy(state, 'writePresentValue');
    discoverFlexitUnitsStub = sinon.stub().resolves([]);
    getBacnetClientStub = sinon.stub().returns(client);

    registry = new UnitRegistry({
      getBacnetClient: getBacnetClientStub,
      discoverFlexitUnits: discoverFlexitUnitsStub,
    });
  });

  afterEach(async () => {
    writePresentValueSpy?.restore();
    registry?.destroy();
    client?.close();
    server?.stop();
    await sleep(25);
  });

  it('resets filter timer using Flexit GO compatible AV:285 write', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 0);
    state.setFilterOperatingHours(750);
    state.setFilterLimitHours(5000);
    registry.register('test_unit', device);
    const filterLimitBeforeReset = state.getFilterStatus().limitHours;

    await registry.resetFilterTimer('test_unit');
    await waitFor(() => state.getFilterStatus().operatingHours < 0.05);

    const filterStatus = state.getFilterStatus();
    expect(filterStatus.operatingHours).toBeLessThan(0.05);
    expect(filterStatus.limitHours).toBeCloseTo(filterLimitBeforeReset, 0.05);

    const goCompatibleResetWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.ANALOG_VALUE
      && call.args[1] === 285
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && Math.abs(call.args[3]) < 0.001
      && call.args[4] === 16
    ));
    expect(goCompatibleResetWrite).not.toBe(undefined);

    const fallbackTriggerWrites = writePresentValueSpy.getCalls().filter((call: any) => (
      call.args[0] === OBJECT_TYPE.MULTI_STATE_VALUE
      && (call.args[1] === 613 || call.args[1] === 609)
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
    ));
    expect(fallbackTriggerWrites).toHaveLength(0);

    const filterIntervalWrites = writePresentValueSpy.getCalls().filter((call: any) => (
      call.args[0] === OBJECT_TYPE.ANALOG_VALUE
      && call.args[1] === 286
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
    ));
    expect(filterIntervalWrites).toHaveLength(0);
  });

  it('uses unit-reported filter limit for reported filter life', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 5000);
    state.setFilterLimitHours(4380);
    state.setFilterOperatingHours(1000);
    registry.register('test_unit', device);

    (registry as any).pollUnit('test_unit');
    await waitFor(() => (
      device.setCapabilityValue.getCalls().some((call: any) => call.args[0] === 'measure_hepa_filter')
    ));

    const filterLifeCalls = device.setCapabilityValue
      .getCalls()
      .filter((call: any) => call.args[0] === 'measure_hepa_filter');

    expect(filterLifeCalls.length).toBeGreaterThan(0);
    const last = filterLifeCalls[filterLifeCalls.length - 1];
    expect(last.args[1]).toBeCloseTo(77.2, 0.2);

    expect(device.setSettings.called).toBe(true);
    const synced = device.setSettings.getCalls().find((call: any) => (
      call.args[0]?.filter_change_interval_hours === 4380
      && call.args[0]?.filter_change_interval_months === 6
    ));
    expect(synced).not.toBe(undefined);
  });

  it('persists a rediscovered BACnet endpoint and reuses it after restart', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);
    await waitFor(() => device.setCapabilityValue.called);

    server.stop();
    await sleep(25);
    server = await createServerOnAddress(state, serverPort, MOVED_SERVER_BIND_ADDRESS);

    device.setSettings.resetHistory();
    device.setAvailable.resetHistory();
    discoverFlexitUnitsStub.resolves([{
      name: 'Nordic Fake',
      serial: '800131-123456',
      serialNormalized: 'test_unit',
      ip: MOVED_SERVER_BIND_ADDRESS,
      bacnetPort: serverPort,
    }]);

    const unit = (registry as any).units.get('test_unit');
    unit.available = false;

    (registry as any).startRediscovery(unit);

    await waitFor(() => device.setSettings.calledWithMatch({
      ip: MOVED_SERVER_BIND_ADDRESS,
      bacnetPort: String(serverPort),
    }));
    await waitFor(() => device.setAvailable.calledOnce);

    expect(device.getSetting('ip')).toBe(MOVED_SERVER_BIND_ADDRESS);
    expect(device.getSetting('bacnetPort')).toBe(String(serverPort));

    registry.destroy();
    device.setCapabilityValue.resetHistory();
    device.setUnavailable.resetHistory();
    discoverFlexitUnitsStub.resetHistory();

    registry = new UnitRegistry({
      getBacnetClient: getBacnetClientStub,
      discoverFlexitUnits: discoverFlexitUnitsStub,
    });
    registry.register('test_unit', device);

    await waitFor(() => device.setCapabilityValue.called);

    expect(discoverFlexitUnitsStub.notCalled).toBe(true);
    expect(device.setUnavailable.notCalled).toBe(true);
  });

  it('writes filter change interval to the unit and verifies it', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    state.setFilterLimitHours(4380);
    registry.register('test_unit', device);

    await registry.setFilterChangeInterval('test_unit', 5000);
    await waitFor(() => Math.abs(state.getFilterStatus().limitHours - 5000) < 0.1);

    expect(state.getFilterStatus().limitHours).toBeCloseTo(5000, 0.1);
    expect(device.getSetting('filter_change_interval_hours')).toBe(5000);
    expect(device.getSetting('filter_change_interval_months')).toBe(
      Math.round(5000 / FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH),
    );
  });

  it('writes heating coil enable/disable using BV:445 with priority 13', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    await registry.setHeatingCoilEnabled('test_unit', false);
    await waitFor(() => {
      const read = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 445, PROPERTY_ID.PRESENT_VALUE);
      return read.ok && read.value.value === 0;
    });

    await registry.setHeatingCoilEnabled('test_unit', true);
    await waitFor(() => {
      const read = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 445, PROPERTY_ID.PRESENT_VALUE);
      return read.ok && read.value.value === 1;
    });

    const writes = writePresentValueSpy.getCalls().filter((call: any) => (
      call.args[0] === OBJECT_TYPE.BINARY_VALUE
      && call.args[1] === 445
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[4] === 13
    ));

    expect(writes.some((call: any) => call.args[3] === 0)).toBe(true);
    expect(writes.some((call: any) => call.args[3] === 1)).toBe(true);
  });

  it('recovers queued setpoint writes after a timed-out BACnet write', async () => {
    registry.destroy();
    registry = new UnitRegistry({
      getBacnetClient: sinon.stub().returns(client),
      discoverFlexitUnits: sinon.stub().resolves([]),
      writeTimeoutMs: SHORT_WRITE_TIMEOUT_MS,
    });

    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    const originalHandleWriteProperty = (server as any).handleWriteProperty.bind(server);
    let ignoredFirstWrite = false;
    const handleWritePropertyStub = sinon.stub(server as any, 'handleWriteProperty').callsFake((request: any) => {
      if (!ignoredFirstWrite) {
        ignoredFirstWrite = true;
        return undefined;
      }
      return originalHandleWriteProperty(request);
    });

    try {
      const firstWrite = registry.writeSetpoint('test_unit', 16).then(
        () => ({ ok: true as const }),
        (error: Error) => ({ ok: false as const, error }),
      );

      const firstResult = await firstWrite;
      expect(firstResult.ok).toBe(false);
      if (firstResult.ok) throw new Error('Expected timed out write to fail');
      expect(String(firstResult.error.message)).to.match(/timeout/i);

      await registry.writeSetpoint('test_unit', 18);
      await waitFor(() => {
        const setpoint = state.readPresentValue(
          OBJECT_TYPE.ANALOG_VALUE,
          1994,
          PROPERTY_ID.PRESENT_VALUE,
        );
        return setpoint.ok && Math.abs(setpoint.value.value - 18) < 0.1;
      });

      const setpoint = state.readPresentValue(
        OBJECT_TYPE.ANALOG_VALUE,
        1994,
        PROPERTY_ID.PRESENT_VALUE,
      );
      if (!setpoint.ok) throw new Error('Expected setpoint to be readable');
      expect(setpoint.value.value).toBeCloseTo(18, 0.1);
      expect(handleWritePropertyStub.callCount).toBe(2);
    } finally {
      handleWritePropertyStub.restore();
    }
  });

  it('marks BACnet devices unavailable when the unit stops responding', { timeout: 15000 }, async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    const unit = (registry as any).units.get('test_unit');
    await waitFor(() => Boolean(unit?.lastPollAt));
    clearInterval(unit.pollInterval);
    unit.pollInterval = null;

    device.setUnavailable.resetHistory();
    server.stop();
    await sleep(50);

    // Manually simulate interval-driven polls to trigger failure threshold.
    // The first call starts a poll that hangs (server stopped). Each subsequent
    // call with fromInterval=true abandons the stale poll and counts a failure.
    (registry as any).pollUnit('test_unit', true); // starts poll that hangs
    (registry as any).pollUnit('test_unit', true); // failure 1, starts new hang
    (registry as any).pollUnit('test_unit', true); // failure 2, starts new hang
    (registry as any).pollUnit('test_unit', true); // failure 3 → unavailable

    await waitFor(() => device.setUnavailable.calledOnce, 5000);
    expect(device.setUnavailable.firstCall.args[0]).toBe(
      'Device unreachable — will auto-reconnect when found',
    );
    expect(unit.available).toBe(false);
  });

  it('reads and toggles heating coil state via BV:445', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    const initialState = await registry.getHeatingCoilEnabled('test_unit');
    expect(initialState).toBe(true);

    const toggledState = await registry.toggleHeatingCoilEnabled('test_unit');
    expect(toggledState).toBe(false);
    await waitFor(() => {
      const read = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 445, PROPERTY_ID.PRESENT_VALUE);
      return read.ok && read.value.value === 0;
    });

    const toggleWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.BINARY_VALUE
      && call.args[1] === 445
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === 0
      && call.args[4] === 13
    ));
    expect(toggleWrite).not.toBe(undefined);
  });

  it('emits heating coil state change callback when the state changes', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    const events: boolean[] = [];
    registry.setHeatingCoilStateChangedHandler((event: any) => {
      events.push(Boolean(event.enabled));
    });

    await registry.getHeatingCoilEnabled('test_unit');
    await registry.setHeatingCoilEnabled('test_unit', false);
    await waitFor(() => events.includes(false));

    await registry.setHeatingCoilEnabled('test_unit', true);
    await waitFor(() => events.includes(true) && events.length >= 2);

    expect(events[0]).toBe(false);
    expect(events[1]).toBe(true);
  });

  it('publishes dehumidification capability from observed BACnet points', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    (state as any).setSimulatedPoint('dehumidification_fan_control', 100);
    (state as any).setSimulatedPoint('dehumidification_request_by_slope', 1);
    (registry as any).pollUnit('test_unit');

    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'dehumidification_active' && call.args[1] === true
    )));

    (state as any).setSimulatedPoint('dehumidification_fan_control', 0);
    (state as any).setSimulatedPoint('dehumidification_request_by_slope', 0);
    device.setCapabilityValue.resetHistory();
    (registry as any).pollUnit('test_unit');

    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'dehumidification_active' && call.args[1] === false
    )));
  });

  it('reads dehumidification state directly from BACnet when requested', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    await waitFor(() => {
      const unit = (registry as any).units.get('test_unit');
      return Boolean(unit);
    });

    const unit = (registry as any).units.get('test_unit');
    if (!unit) throw new Error('Expected unit to exist');

    unit.dehumidificationActive = undefined;
    unit.dehumidificationStateInitialized = false;
    unit.probeValues.delete('2:1870');
    unit.probeValues.delete('5:653');

    (state as any).setSimulatedPoint('dehumidification_fan_control', 100);
    (state as any).setSimulatedPoint('dehumidification_request_by_slope', 1);
    const active = await registry.getDehumidificationActive('test_unit');
    expect(active).toBe(true);

    unit.dehumidificationActive = undefined;
    unit.dehumidificationStateInitialized = false;
    unit.probeValues.delete('2:1870');
    unit.probeValues.delete('5:653');

    (state as any).setSimulatedPoint('dehumidification_fan_control', 0);
    (state as any).setSimulatedPoint('dehumidification_request_by_slope', 0);
    const inactive = await registry.getDehumidificationActive('test_unit');
    expect(inactive).toBe(false);
  });

  it('publishes free cooling capability from observed BACnet points', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    (state as any).setSimulatedPoint('free_cooling_enabled', 1);
    (state as any).setSimulatedPoint('free_cooling_setpoint_room', 22);
    (state as any).setSimulatedPoint('free_cooling_outside_temp_limit', 18);
    (state as any).setSimulatedPoint('temp_room', 24);
    (state as any).setSimulatedPoint('temp_outside', 12);
    (registry as any).pollUnit('test_unit');

    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'free_cooling_active' && call.args[1] === true
    )));

    (state as any).setSimulatedPoint('free_cooling_enabled', 0);
    device.setCapabilityValue.resetHistory();
    (registry as any).pollUnit('test_unit');

    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'free_cooling_active' && call.args[1] === false
    )));
  });

  it('reads free cooling state directly from BACnet when requested', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    await waitFor(() => {
      const unit = (registry as any).units.get('test_unit');
      return Boolean(unit);
    });

    const unit = (registry as any).units.get('test_unit');
    if (!unit) throw new Error('Expected unit to exist');

    unit.freeCoolingActive = undefined;
    unit.freeCoolingStateInitialized = false;
    unit.probeValues.delete('19:19');

    (state as any).setSimulatedPoint('free_cooling_enabled', 1);
    (state as any).setSimulatedPoint('free_cooling_setpoint_room', 22);
    (state as any).setSimulatedPoint('free_cooling_outside_temp_limit', 18);
    (state as any).setSimulatedPoint('temp_room', 24);
    (state as any).setSimulatedPoint('temp_outside', 12);
    const active = await registry.getFreeCoolingActive('test_unit');
    expect(active).toBe(true);

    unit.freeCoolingActive = undefined;
    unit.freeCoolingStateInitialized = false;
    unit.probeValues.delete('19:19');

    (state as any).setSimulatedPoint('free_cooling_enabled', 0);
    const inactive = await registry.getFreeCoolingActive('test_unit');
    expect(inactive).toBe(false);
  });

  it('writes home fan profile using AV 1836/1841 with priority 16', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    await registry.setFanProfileMode('test_unit', 'home', 70, 60);
    await waitFor(() => {
      const supply = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 1836, PROPERTY_ID.PRESENT_VALUE);
      const exhaust = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 1841, PROPERTY_ID.PRESENT_VALUE);
      return supply.ok
        && exhaust.ok
        && Math.abs(supply.value.value - 70) < 0.1
        && Math.abs(exhaust.value.value - 60) < 0.1;
    });

    const writes = writePresentValueSpy.getCalls().filter((call: any) => (
      call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[4] === 16
      && call.args[0] === OBJECT_TYPE.ANALOG_VALUE
      && (call.args[1] === 1836 || call.args[1] === 1841)
    ));
    expect(writes.length).toBe(2);
    expect(device.getSetting('fan_profile_home_supply')).toBe(70);
    expect(device.getSetting('fan_profile_home_exhaust')).toBe(60);
  });

  it('writes fireplace duration to PIV:270 with priority 13 and syncs setting', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    await registry.setFireplaceVentilationDuration('test_unit', 27);
    await waitFor(() => {
      const runtime = state.readPresentValue(
        OBJECT_TYPE.POSITIVE_INTEGER_VALUE,
        270,
        PROPERTY_ID.PRESENT_VALUE,
      );
      return runtime.ok && runtime.value.value === 27;
    });

    const runtimeWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.POSITIVE_INTEGER_VALUE
      && call.args[1] === 270
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === 27
      && call.args[4] === 13
    ));
    expect(runtimeWrite).not.toBe(undefined);
    expect(device.getSetting('fireplace_duration_minutes')).toBe(27);
  });

  it('writes free cooling settings with priority 13 and syncs settings', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    await registry.setFreeCoolingEnabled('test_unit', true);
    await registry.setFreeCoolingTemperatureSetpoint('test_unit', 24.5);
    await registry.setFreeCoolingOutsideTemperatureLimit('test_unit', 16.5);
    await registry.setFreeCoolingMinOnTimeSeconds('test_unit', 1200);

    await waitFor(() => {
      const enabled = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 478, PROPERTY_ID.PRESENT_VALUE);
      const setpoint = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 2071, PROPERTY_ID.PRESENT_VALUE);
      const outside = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 1934, PROPERTY_ID.PRESENT_VALUE);
      const runtime = state.readPresentValue(OBJECT_TYPE.POSITIVE_INTEGER_VALUE, 296, PROPERTY_ID.PRESENT_VALUE);
      return enabled.ok
        && setpoint.ok
        && outside.ok
        && runtime.ok
        && enabled.value.value === 1
        && Math.abs(setpoint.value.value - 24.5) < 0.1
        && Math.abs(outside.value.value - 16.5) < 0.1
        && runtime.value.value === 1200;
    });

    const writes = writePresentValueSpy.getCalls().filter((call: any) => (
      call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[4] === 13
      && (
        (call.args[0] === OBJECT_TYPE.BINARY_VALUE && call.args[1] === 478)
        || (call.args[0] === OBJECT_TYPE.ANALOG_VALUE && (call.args[1] === 2071 || call.args[1] === 1934))
        || (call.args[0] === OBJECT_TYPE.POSITIVE_INTEGER_VALUE && call.args[1] === 296)
      )
    ));
    expect(writes.length).toBe(4);
    expect(device.getSetting('free_cooling_enabled')).toBe(true);
    expect(device.getSetting('free_cooling_extract_temp_setpoint')).toBe(24.5);
    expect(device.getSetting('free_cooling_outside_temp_limit')).toBe(16.5);
    expect(device.getSetting('free_cooling_min_on_time_seconds')).toBe(1200);
  });

  it('does not re-trigger fireplace when fireplace is already active', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    await registry.setFireplaceVentilationDuration('test_unit', 10);
    await registry.setFanMode('test_unit', 'fireplace');
    await waitFor(() => {
      const fireplaceActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 400, PROPERTY_ID.PRESENT_VALUE);
      const operationMode = state.readPresentValue(OBJECT_TYPE.MULTI_STATE_VALUE, 361, PROPERTY_ID.PRESENT_VALUE);
      return fireplaceActive.ok
        && operationMode.ok
        && fireplaceActive.value.value === 1
        && operationMode.value.value === OPERATION_MODE_VALUES.FIREPLACE;
    });

    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'fireplace'
    )));

    state.advanceSimulatedSeconds(60);
    const activeRemaining = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 2038, PROPERTY_ID.PRESENT_VALUE);
    if (!activeRemaining.ok) throw new Error('Expected remaining fireplace runtime to be readable');
    expect(activeRemaining.value.value).toBeLessThan(10);

    writePresentValueSpy.resetHistory();
    device.setCapabilityValue.resetHistory();

    await registry.setFanMode('test_unit', 'fireplace');
    expect(writePresentValueSpy.called).toBe(false);

    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'fireplace'
    )));

    state.advanceSimulatedSeconds(60);
    const continuedRemaining = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 2038, PROPERTY_ID.PRESENT_VALUE);
    const fireplaceActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 400, PROPERTY_ID.PRESENT_VALUE);
    const operationMode = state.readPresentValue(OBJECT_TYPE.MULTI_STATE_VALUE, 361, PROPERTY_ID.PRESENT_VALUE);
    if (!continuedRemaining.ok || !fireplaceActive.ok || !operationMode.ok) {
      throw new Error('Expected fireplace runtime and mode points to be readable');
    }
    expect(continuedRemaining.value.value).toBeLessThan(activeRemaining.value.value - 0.5);
    expect(fireplaceActive.value.value).toBe(1);
    expect(operationMode.value.value).toBe(OPERATION_MODE_VALUES.FIREPLACE);
  });

  it('returns to home from fireplace without re-triggering high ventilation', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    await registry.setFireplaceVentilationDuration('test_unit', 12);
    await registry.setFanMode('test_unit', 'fireplace');
    await waitFor(() => {
      const fireplaceActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 400, PROPERTY_ID.PRESENT_VALUE);
      const operationMode = state.readPresentValue(OBJECT_TYPE.MULTI_STATE_VALUE, 361, PROPERTY_ID.PRESENT_VALUE);
      const remainingTempVent = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 2005, PROPERTY_ID.PRESENT_VALUE);
      return fireplaceActive.ok
        && operationMode.ok
        && remainingTempVent.ok
        && fireplaceActive.value.value === 1
        && operationMode.value.value === OPERATION_MODE_VALUES.FIREPLACE
        && remainingTempVent.value.value > 0;
    });

    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'fireplace'
    )));

    writePresentValueSpy.resetHistory();
    device.setCapabilityValue.resetHistory();

    await registry.setFanMode('test_unit', 'home');
    await waitFor(() => {
      const fireplaceActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 400, PROPERTY_ID.PRESENT_VALUE);
      const rapidActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 15, PROPERTY_ID.PRESENT_VALUE);
      const operationMode = state.readPresentValue(OBJECT_TYPE.MULTI_STATE_VALUE, 361, PROPERTY_ID.PRESENT_VALUE);
      const remainingTempVent = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 2005, PROPERTY_ID.PRESENT_VALUE);
      return fireplaceActive.ok
        && rapidActive.ok
        && operationMode.ok
        && remainingTempVent.ok
        && fireplaceActive.value.value === 0
        && rapidActive.value.value === 0
        && operationMode.value.value === OPERATION_MODE_VALUES.HOME
        && remainingTempVent.value.value === 0;
    });

    const fireplaceTriggerWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.MULTI_STATE_VALUE
      && call.args[1] === 360
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === 2
      && call.args[4] === 13
    ));
    const rapidTriggerWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.MULTI_STATE_VALUE
      && call.args[1] === 357
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === 2
    ));
    const resetTempVentWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.BINARY_VALUE
      && call.args[1] === 452
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
    ));
    expect(fireplaceTriggerWrite).not.toBe(undefined);
    expect(rapidTriggerWrite).toBe(undefined);
    expect(resetTempVentWrite).toBe(undefined);

    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'home'
    )));
  });

  it('returns to home from temporary high without re-triggering rapid ventilation', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    expect(state.startRapid(12).ok).toBe(true);

    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'high'
    )));

    writePresentValueSpy.resetHistory();
    device.setCapabilityValue.resetHistory();

    await registry.setFanMode('test_unit', 'home');
    await waitFor(() => {
      const rapidActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 15, PROPERTY_ID.PRESENT_VALUE);
      const operationMode = state.readPresentValue(OBJECT_TYPE.MULTI_STATE_VALUE, 361, PROPERTY_ID.PRESENT_VALUE);
      const remainingTempVent = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 2005, PROPERTY_ID.PRESENT_VALUE);
      return rapidActive.ok
        && operationMode.ok
        && remainingTempVent.ok
        && rapidActive.value.value === 0
        && operationMode.value.value === OPERATION_MODE_VALUES.HOME
        && remainingTempVent.value.value === 0;
    });

    const rapidTriggerWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.MULTI_STATE_VALUE
      && call.args[1] === 357
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === 2
      && call.args[4] === 13
    ));
    const fireplaceTriggerWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.MULTI_STATE_VALUE
      && call.args[1] === 360
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === 2
    ));
    const resetTempVentWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.BINARY_VALUE
      && call.args[1] === 452
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
    ));
    expect(rapidTriggerWrite).not.toBe(undefined);
    expect(fireplaceTriggerWrite).toBe(undefined);
    expect(resetTempVentWrite).toBe(undefined);

    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'home'
    )));
  });

  it('writes the observed rapid/fireplace trigger sequence from temporary high', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    expect(state.startRapid(12).ok).toBe(true);

    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'high'
    )));

    writePresentValueSpy.resetHistory();
    device.setCapabilityValue.resetHistory();

    await registry.setFanMode('test_unit', 'fireplace');

    const runtimeWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.POSITIVE_INTEGER_VALUE
      && call.args[1] === 270
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === 10
      && call.args[4] === 13
    ));
    const rapidTriggerWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.MULTI_STATE_VALUE
      && call.args[1] === 357
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === 2
    ));
    const fireplaceTriggerWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.MULTI_STATE_VALUE
      && call.args[1] === 360
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === 2
    ));
    expect(runtimeWrite).not.toBe(undefined);
    expect(rapidTriggerWrite).not.toBe(undefined);
    expect(fireplaceTriggerWrite).not.toBe(undefined);

    await waitFor(() => {
      const rapidActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 15, PROPERTY_ID.PRESENT_VALUE);
      const fireplaceActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 400, PROPERTY_ID.PRESENT_VALUE);
      const operationMode = state.readPresentValue(OBJECT_TYPE.MULTI_STATE_VALUE, 361, PROPERTY_ID.PRESENT_VALUE);
      return rapidActive.ok
        && fireplaceActive.ok
        && operationMode.ok
        && rapidActive.value.value === 0
        && fireplaceActive.value.value === 1
        && operationMode.value.value === OPERATION_MODE_VALUES.FIREPLACE;
    });

    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'fireplace'
    )));
  });

  it('writes fireplace trigger without rapid trigger when switching from home', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'home'
    )));

    writePresentValueSpy.resetHistory();
    device.setCapabilityValue.resetHistory();

    await registry.setFanMode('test_unit', 'fireplace');

    const runtimeWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.POSITIVE_INTEGER_VALUE
      && call.args[1] === 270
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[4] === 13
    ));
    const rapidTriggerWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.MULTI_STATE_VALUE
      && call.args[1] === 357
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === 2
    ));
    const fireplaceTriggerWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.MULTI_STATE_VALUE
      && call.args[1] === 360
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === 2
    ));
    const resetTempVentWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.BINARY_VALUE
      && call.args[1] === 452
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
    ));

    expect(runtimeWrite).not.toBe(undefined);
    expect(rapidTriggerWrite).toBe(undefined);
    expect(fireplaceTriggerWrite).not.toBe(undefined);
    expect(resetTempVentWrite).toBe(undefined);

    await waitFor(() => {
      const fireplaceActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 400, PROPERTY_ID.PRESENT_VALUE);
      const operationMode = state.readPresentValue(OBJECT_TYPE.MULTI_STATE_VALUE, 361, PROPERTY_ID.PRESENT_VALUE);
      return fireplaceActive.ok
        && operationMode.ok
        && fireplaceActive.value.value === 1
        && operationMode.value.value === OPERATION_MODE_VALUES.FIREPLACE;
    });
  });

  it('transitions between all user-facing fan modes against the fake unit', { timeout: 30000 }, async () => {
    const modes = ['home', 'away', 'high', 'fireplace', 'cooker'] as const;
    type TestFanMode = typeof modes[number];

    const waitForStateMode = async (mode: TestFanMode) => {
      await waitFor(() => {
        const comfort = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 50, PROPERTY_ID.PRESENT_VALUE);
        const awayDelayActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 574, PROPERTY_ID.PRESENT_VALUE);
        const rapidActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 15, PROPERTY_ID.PRESENT_VALUE);
        const fireplaceActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 400, PROPERTY_ID.PRESENT_VALUE);
        const cookerHood = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 402, PROPERTY_ID.PRESENT_VALUE);
        const operationMode = state.readPresentValue(
          OBJECT_TYPE.MULTI_STATE_VALUE,
          361,
          PROPERTY_ID.PRESENT_VALUE,
        );
        if (
          !comfort.ok
          || !awayDelayActive.ok
          || !rapidActive.ok
          || !fireplaceActive.ok
          || !cookerHood.ok
          || !operationMode.ok
        ) {
          return false;
        }

        switch (mode) {
          case 'home':
            return comfort.value.value === 1
              && awayDelayActive.value.value === 0
              && rapidActive.value.value === 0
              && fireplaceActive.value.value === 0
              && cookerHood.value.value === 0
              && operationMode.value.value === OPERATION_MODE_VALUES.HOME;
          case 'away':
            return comfort.value.value === 0
              && awayDelayActive.value.value === 0
              && rapidActive.value.value === 0
              && fireplaceActive.value.value === 0
              && cookerHood.value.value === 0
              && operationMode.value.value === OPERATION_MODE_VALUES.AWAY;
          case 'high':
            return fireplaceActive.value.value === 0
              && cookerHood.value.value === 0
              && (
                operationMode.value.value === OPERATION_MODE_VALUES.HIGH
                || operationMode.value.value === OPERATION_MODE_VALUES.TEMPORARY_HIGH
              );
          case 'fireplace':
            return rapidActive.value.value === 0
              && fireplaceActive.value.value === 1
              && cookerHood.value.value === 0
              && operationMode.value.value === OPERATION_MODE_VALUES.FIREPLACE;
          case 'cooker':
            return rapidActive.value.value === 0
              && fireplaceActive.value.value === 0
              && cookerHood.value.value === 1
              && operationMode.value.value === OPERATION_MODE_VALUES.COOKER_HOOD;
          default:
            return false;
        }
      });
    };

    const pollUntilReportedMode = async (device: any, mode: TestFanMode) => {
      device.setCapabilityValue.resetHistory();
      (registry as any).pollUnit('test_unit');
      await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
        call.args[0] === 'fan_mode' && call.args[1] === mode
      )));
    };

    const resetFakeUnitToHome = () => {
      expect(
        state.writePresentValue(
          OBJECT_TYPE.POSITIVE_INTEGER_VALUE,
          318,
          PROPERTY_ID.PRESENT_VALUE,
          0,
          13,
        ).ok,
      ).toBe(true);
      expect(
        state.writePresentValue(
          OBJECT_TYPE.BINARY_VALUE,
          452,
          PROPERTY_ID.PRESENT_VALUE,
          1,
          13,
        ).ok,
      ).toBe(true);
      expect(
        state.writePresentValue(
          OBJECT_TYPE.BINARY_VALUE,
          402,
          PROPERTY_ID.PRESENT_VALUE,
          null,
          13,
        ).ok,
      ).toBe(true);
      expect((state as any).setSimulatedPoint('cooker_hood', 0).ok).toBe(true);
      expect(
        state.writePresentValue(
          OBJECT_TYPE.BINARY_VALUE,
          50,
          PROPERTY_ID.PRESENT_VALUE,
          1,
          13,
        ).ok,
      ).toBe(true);
      expect(
        state.writePresentValue(
          OBJECT_TYPE.MULTI_STATE_VALUE,
          42,
          PROPERTY_ID.PRESENT_VALUE,
          3,
          13,
        ).ok,
      ).toBe(true);
    };

    const createRegisteredDevice = async () => {
      registry?.destroy();
      registry = new UnitRegistry({
        getBacnetClient: sinon.stub().returns(client),
        discoverFlexitUnits: sinon.stub().resolves([]),
      });
      const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
      registry.register('test_unit', device);
      await pollUntilReportedMode(device, 'home');
      return device;
    };

    const setSourceMode = async (device: any, mode: TestFanMode) => {
      if (mode === 'high') {
        expect(state.startRapid(12).ok).toBe(true);
        await waitForStateMode('high');
        await pollUntilReportedMode(device, 'high');
        return;
      }

      if (mode !== 'home') {
        await registry.setFanMode('test_unit', mode);
      }
      await waitForStateMode(mode);
      await pollUntilReportedMode(device, mode);
    };

    for (const fromMode of modes) {
      for (const toMode of modes) {
        if (fromMode === toMode) continue;

        resetFakeUnitToHome();
        const device = await createRegisteredDevice();
        await setSourceMode(device, fromMode);

        writePresentValueSpy.resetHistory();
        device.setCapabilityValue.resetHistory();

        await registry.setFanMode('test_unit', toMode);
        await waitForStateMode(toMode);
        await pollUntilReportedMode(device, toMode);

        expect(
          writePresentValueSpy.callCount,
          `Expected BACnet writes for ${fromMode} -> ${toMode}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('treats away as active when comfort button is away but operation mode still reports home', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    const logger = {
      log: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
    registry.setLogger(logger);
    registry.register('test_unit', device);

    const originalTick = state.tick.bind(state);
    const tickStub = sinon.stub(state, 'tick').callsFake((nowMs?: number) => {
      originalTick(nowMs);
      (state as any).setByName('comfort_button', 0);
      (state as any).setByName('operation_mode', OPERATION_MODE_VALUES.HOME);
      (state as any).setByName('ventilation_mode', 3);
      (state as any).setByName('away_delay_active', 0);
    });

    try {
      await registry.setFanMode('test_unit', 'away');

      device.setCapabilityValue.resetHistory();
      (registry as any).pollUnit('test_unit');

      await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
        call.args[0] === 'fan_mode' && call.args[1] === 'away'
      )));

      writePresentValueSpy.resetHistory();
      await registry.writeSetpoint('test_unit', 17.5);

      const awaySetpointWrite = writePresentValueSpy.getCalls().find((call: any) => (
        call.args[0] === OBJECT_TYPE.ANALOG_VALUE
        && call.args[1] === 1985
        && call.args[2] === PROPERTY_ID.PRESENT_VALUE
        && call.args[3] === 17.5
        && call.args[4] === 13
      ));
      expect(awaySetpointWrite).not.toBe(undefined);
      expect(logger.warn.calledWithMatch('[UnitRegistry] Mode mismatch')).toBe(false);
    } finally {
      tickStub.restore();
    }
  });

  it('writes cooker hood mode and updates the unit and Homey capabilities', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    await registry.setFanMode('test_unit', 'cooker');
    await waitFor(() => {
      const cookerHood = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 402, PROPERTY_ID.PRESENT_VALUE);
      const operationMode = state.readPresentValue(OBJECT_TYPE.MULTI_STATE_VALUE, 361, PROPERTY_ID.PRESENT_VALUE);
      return cookerHood.ok
        && operationMode.ok
        && cookerHood.value.value === 1
        && operationMode.value.value === OPERATION_MODE_VALUES.COOKER_HOOD;
    });

    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'cooker'
    )));
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'measure_fan_setpoint_percent' && call.args[1] === 90
    )));
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'measure_fan_setpoint_percent.extract' && call.args[1] === 50
    )));

    const cookerWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.BINARY_VALUE
      && call.args[1] === 402
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === 1
      && call.args[4] === 13
    ));
    expect(cookerWrite).not.toBe(undefined);
  });

  it('relinquishes cooker hood so a remote cooker trigger can take over again', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    await registry.setFanMode('test_unit', 'cooker');
    await waitFor(() => {
      const cookerHood = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 402, PROPERTY_ID.PRESENT_VALUE);
      return cookerHood.ok && cookerHood.value.value === 1;
    });

    device.setCapabilityValue.resetHistory();
    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'cooker'
    )));

    writePresentValueSpy.resetHistory();
    await registry.setFanMode('test_unit', 'away');

    await waitFor(() => writePresentValueSpy.getCalls().some((call: any) => (
      call.args[0] === OBJECT_TYPE.BINARY_VALUE
      && call.args[1] === 402
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === null
      && call.args[4] === 13
    )));
    const relinquishWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.BINARY_VALUE
      && call.args[1] === 402
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[3] === null
      && call.args[4] === 13
    ));
    expect(relinquishWrite).not.toBe(undefined);

    device.setCapabilityValue.resetHistory();
    (state as any).setSimulatedPoint('cooker_hood', 1);

    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'cooker'
    )));
  });

  it('detects cooker hood mode and sets fan capabilities accordingly', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    // Simulate cooker hood activation in the fake unit
    (state as any).setSimulatedPoint('cooker_hood', 1);

    (registry as any).pollUnit('test_unit');
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'fan_mode' && call.args[1] === 'cooker'
    )));

    // Verify it also updates the fan profile setpoints to cooker values
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'measure_fan_setpoint_percent' && call.args[1] === 90
    )));
    await waitFor(() => device.setCapabilityValue.getCalls().some((call: any) => (
      call.args[0] === 'measure_fan_setpoint_percent.extract' && call.args[1] === 50
    )));
  });
});
