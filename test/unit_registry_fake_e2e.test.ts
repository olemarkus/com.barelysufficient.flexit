/* eslint-disable import/extensions */
import dgram from 'dgram';
import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';
import { getFreePort, sleep } from './test_utils.ts';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Bacnet = require('bacstack');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { UnitRegistry } = require('../lib/UnitRegistry.ts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FakeBacnetServer } = require('../scripts/fake-unit/bacnetServer.ts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FakeNordicUnitState } = require('../scripts/fake-unit/state.ts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  DEFAULT_DEVICE_NAME,
  DEFAULT_FIRMWARE,
  DEFAULT_MODEL_NAME,
  OBJECT_TYPE,
  PROPERTY_ID,
  DEFAULT_VENDOR_ID,
  DEFAULT_VENDOR_NAME,
} = require('../scripts/fake-unit/manifest.ts');

const CLIENT_BIND_ADDRESS = '127.0.0.1';
const SERVER_BIND_ADDRESS = '127.0.0.2';
const SOCKET_LISTEN_TIMEOUT_MS = 2000;
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
  let currentFilterIntervalHours = filterIntervalHours;
  let currentFilterIntervalMonths = Math.max(
    1,
    Math.round(filterIntervalHours / FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH),
  );
  const currentFanSettings = { ...DEFAULT_FAN_SETTINGS };
  const currentTargetTemperatureSettings = { ...DEFAULT_TARGET_TEMPERATURE_SETTINGS };
  const getSetting = sinon.stub();
  getSetting.withArgs('ip').returns(serverIp);
  getSetting.withArgs('bacnetPort').returns(serverPort);
  getSetting.withArgs('serial').returns('800131-123456');
  getSetting.withArgs('filter_change_interval_hours').callsFake(() => currentFilterIntervalHours);
  getSetting.withArgs('filter_change_interval_months').callsFake(() => currentFilterIntervalMonths);
  getSetting.callsFake((key: string) => {
    if (Object.prototype.hasOwnProperty.call(currentFanSettings, key)) return currentFanSettings[key];
    if (Object.prototype.hasOwnProperty.call(currentTargetTemperatureSettings, key)) return currentTargetTemperatureSettings[key];
    return undefined;
  });

  const setSettings = sinon.stub().callsFake(async (settings: Record<string, any>) => {
    const nextHours = settings?.filter_change_interval_hours;
    const nextMonths = settings?.filter_change_interval_months;
    if (typeof nextHours === 'number' && Number.isFinite(nextHours)) {
      currentFilterIntervalHours = nextHours;
      currentFilterIntervalMonths = Math.max(1, Math.round(nextHours / FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH));
    }
    if (typeof nextMonths === 'number' && Number.isFinite(nextMonths) && !(typeof nextHours === 'number' && Number.isFinite(nextHours))) {
      currentFilterIntervalMonths = nextMonths;
      currentFilterIntervalHours = Math.round(nextMonths * FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH);
    }
    for (const [key, value] of Object.entries(settings ?? {})) {
      if (!Object.prototype.hasOwnProperty.call(currentFanSettings, key)) continue;
      if (typeof value === 'number' && Number.isFinite(value)) {
        currentFanSettings[key] = value;
      }
    }
    for (const [key, value] of Object.entries(settings ?? {})) {
      if (!Object.prototype.hasOwnProperty.call(currentTargetTemperatureSettings, key)) continue;
      if (typeof value === 'number' && Number.isFinite(value)) {
        currentTargetTemperatureSettings[key] = value;
      }
    }
  });
  const setSetting = sinon.stub().callsFake(async (settings: Record<string, any>) => {
    const nextHours = settings?.filter_change_interval_hours;
    const nextMonths = settings?.filter_change_interval_months;
    if (typeof nextHours === 'number' && Number.isFinite(nextHours)) {
      currentFilterIntervalHours = nextHours;
      currentFilterIntervalMonths = Math.max(1, Math.round(nextHours / FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH));
    }
    if (typeof nextMonths === 'number' && Number.isFinite(nextMonths) && !(typeof nextHours === 'number' && Number.isFinite(nextHours))) {
      currentFilterIntervalMonths = nextMonths;
      currentFilterIntervalHours = Math.round(nextMonths * FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH);
    }
    for (const [key, value] of Object.entries(settings ?? {})) {
      if (!Object.prototype.hasOwnProperty.call(currentFanSettings, key)) continue;
      if (typeof value === 'number' && Number.isFinite(value)) {
        currentFanSettings[key] = value;
      }
    }
    for (const [key, value] of Object.entries(settings ?? {})) {
      if (!Object.prototype.hasOwnProperty.call(currentTargetTemperatureSettings, key)) continue;
      if (typeof value === 'number' && Number.isFinite(value)) {
        currentTargetTemperatureSettings[key] = value;
      }
    }
  });

  return {
    getData: sinon.stub().returns({ unitId: 'test_unit' }),
    getSetting,
    setSettings,
    setSetting,
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

describe('UnitRegistry fake-unit e2e', function unitRegistryFakeUdpE2e() {
  this.timeout(10000);

  let registry: any;
  let state: any;
  let client: any;
  let server: any;
  let writePresentValueSpy: sinon.SinonSpy;
  let serverPort = 47808;

  beforeEach(async () => {
    const harness = await createBacnetHarness();
    state = harness.state;
    client = harness.client;
    server = harness.server;
    serverPort = harness.serverPort;
    writePresentValueSpy = sinon.spy(state, 'writePresentValue');

    registry = new UnitRegistry({
      getBacnetClient: sinon.stub().returns(client),
      discoverFlexitUnits: sinon.stub().resolves([]),
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
    expect(filterStatus.operatingHours).to.be.lessThan(0.05);
    expect(filterStatus.limitHours).to.be.closeTo(filterLimitBeforeReset, 0.05);

    const goCompatibleResetWrite = writePresentValueSpy.getCalls().find((call: any) => (
      call.args[0] === OBJECT_TYPE.ANALOG_VALUE
      && call.args[1] === 285
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && Math.abs(call.args[3]) < 0.001
      && call.args[4] === 16
    ));
    expect(goCompatibleResetWrite).to.not.equal(undefined);

    const fallbackTriggerWrites = writePresentValueSpy.getCalls().filter((call: any) => (
      call.args[0] === OBJECT_TYPE.MULTI_STATE_VALUE
      && (call.args[1] === 613 || call.args[1] === 609)
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
    ));
    expect(fallbackTriggerWrites).to.have.length(0);

    const filterIntervalWrites = writePresentValueSpy.getCalls().filter((call: any) => (
      call.args[0] === OBJECT_TYPE.ANALOG_VALUE
      && call.args[1] === 286
      && call.args[2] === PROPERTY_ID.PRESENT_VALUE
    ));
    expect(filterIntervalWrites).to.have.length(0);
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

    expect(filterLifeCalls.length).to.be.greaterThan(0);
    const last = filterLifeCalls[filterLifeCalls.length - 1];
    expect(last.args[1]).to.be.closeTo(77.2, 0.2);

    expect(device.setSettings.called).to.equal(true);
    const synced = device.setSettings.getCalls().find((call: any) => (
      call.args[0]?.filter_change_interval_hours === 4380
      && call.args[0]?.filter_change_interval_months === 6
    ));
    expect(synced).to.not.equal(undefined);
  });

  it('writes filter change interval to the unit and verifies it', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    state.setFilterLimitHours(4380);
    registry.register('test_unit', device);

    await registry.setFilterChangeInterval('test_unit', 5000);
    await waitFor(() => Math.abs(state.getFilterStatus().limitHours - 5000) < 0.1);

    expect(state.getFilterStatus().limitHours).to.be.closeTo(5000, 0.1);
    expect(device.getSetting('filter_change_interval_hours')).to.equal(5000);
    expect(device.getSetting('filter_change_interval_months')).to.equal(
      Math.round(5000 / FILTER_CHANGE_INTERVAL_HOURS_PER_MONTH),
    );
  });

  it('writes home fan profile using AV 1836/1841 with priority 16', async () => {
    const device = makeMockDevice(SERVER_BIND_ADDRESS, serverPort, 4380);
    registry.register('test_unit', device);

    await registry.setFanProfileMode('test_unit', 'home', 70, 60);
    await waitFor(() => {
      const supply = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 1836, PROPERTY_ID.PRESENT_VALUE);
      const exhaust = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 1841, PROPERTY_ID.PRESENT_VALUE);
      return supply.ok && exhaust.ok && Math.abs(supply.value.value - 70) < 0.1 && Math.abs(exhaust.value.value - 60) < 0.1;
    });

    const writes = writePresentValueSpy.getCalls().filter((call: any) => (
      call.args[2] === PROPERTY_ID.PRESENT_VALUE
      && call.args[4] === 16
      && call.args[0] === OBJECT_TYPE.ANALOG_VALUE
      && (call.args[1] === 1836 || call.args[1] === 1841)
    ));
    expect(writes.length).to.equal(2);
    expect(device.getSetting('fan_profile_home_supply')).to.equal(70);
    expect(device.getSetting('fan_profile_home_exhaust')).to.equal(60);
  });
});
