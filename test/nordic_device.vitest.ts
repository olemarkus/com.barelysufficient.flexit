import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sinon from 'sinon';

const EXHAUST_TEMP_CAPABILITY = 'measure_temperature.exhaust';
const DEHUMIDIFICATION_ACTIVE_CAPABILITY = 'dehumidification_active';
const FREE_COOLING_ACTIVE_CAPABILITY = 'free_cooling_active';
const RESET_FILTER_CAPABILITY = 'button.reset_filter';

class MockHomeyDevice {
  setClass = sinon.stub().resolves();
  hasCapability = sinon.stub().returns(true);
  addCapability = sinon.stub().resolves();
  setSettings = sinon.stub().resolves();
  getSetting = sinon.stub().returns(undefined);
  registerCapabilityListener = sinon.stub();
  getCapabilityValue = sinon.stub().returns(undefined);
  getData = sinon.stub().returns({ unitId: 'test_unit' });
  getName = sinon.stub().returns('Test Nordic');
  log = sinon.stub();
  error = sinon.stub();
}

const nordicDeviceMocks = vi.hoisted(() => ({
  unitRegistryModuleStub: {} as Record<string, any>,
}));

vi.mock('homey', () => ({
  default: { Device: MockHomeyDevice },
}));

vi.mock('../lib/UnitRegistry', () => nordicDeviceMocks.unitRegistryModuleStub);

describe('Nordic device', () => {
  let DeviceClass: any;
  let registryStub: any;

  beforeEach(async () => {
    vi.resetModules();
    registryStub = {
      register: sinon.stub(),
      unregister: sinon.stub(),
      writeSetpoint: sinon.stub().resolves(),
      setTemperatureSetpoint: sinon.stub().resolves(),
      setFanMode: sinon.stub().resolves(),
      setFanProfileMode: sinon.stub().resolves(),
      resetFilterTimer: sinon.stub().resolves(),
      setFilterChangeInterval: sinon.stub().resolves(),
      setFireplaceVentilationDuration: sinon.stub().resolves(),
      setFreeCoolingEnabled: sinon.stub().resolves(),
      setFreeCoolingTemperatureSetpoint: sinon.stub().resolves(),
      setFreeCoolingOutsideTemperatureLimit: sinon.stub().resolves(),
      setFreeCoolingMinOnTimeSeconds: sinon.stub().resolves(),
    };

    const unitRegistryModuleStub = {
      Registry: registryStub,
      FILTER_CHANGE_INTERVAL_MONTHS_SETTING: 'filter_change_interval_months',
      FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING: 'filter_change_interval_hours',
      TARGET_TEMPERATURE_HOME_SETTING: 'target_temperature_home',
      TARGET_TEMPERATURE_AWAY_SETTING: 'target_temperature_away',
      FREE_COOLING_ENABLED_SETTING: 'free_cooling_enabled',
      FREE_COOLING_TEMPERATURE_SETPOINT_SETTING: 'free_cooling_extract_temp_setpoint',
      FREE_COOLING_OUTSIDE_TEMPERATURE_LIMIT_SETTING: 'free_cooling_outside_temp_limit',
      FREE_COOLING_MIN_ON_TIME_SECONDS_SETTING: 'free_cooling_min_on_time_seconds',
      FIREPLACE_DURATION_SETTING: 'fireplace_duration_minutes',
      MIN_TARGET_TEMPERATURE_C: 10,
      MAX_TARGET_TEMPERATURE_C: 30,
      MIN_FREE_COOLING_TEMPERATURE_C: 10,
      MAX_FREE_COOLING_TEMPERATURE_C: 30,
      MIN_FREE_COOLING_MIN_ON_TIME_SECONDS: 0,
      MAX_FREE_COOLING_MIN_ON_TIME_SECONDS: 18000,
      FAN_PROFILE_MODES: ['home', 'away', 'high', 'fireplace', 'cooker'],
      FAN_PROFILE_SETTING_KEYS: {
        home: { supply: 'fan_profile_home_supply', exhaust: 'fan_profile_home_exhaust' },
        away: { supply: 'fan_profile_away_supply', exhaust: 'fan_profile_away_exhaust' },
        high: { supply: 'fan_profile_high_supply', exhaust: 'fan_profile_high_exhaust' },
        fireplace: { supply: 'fan_profile_fireplace_supply', exhaust: 'fan_profile_fireplace_exhaust' },
        cooker: { supply: 'fan_profile_cooker_supply', exhaust: 'fan_profile_cooker_exhaust' },
      },
      MIN_FILTER_CHANGE_INTERVAL_HOURS: 2196,
      MAX_FILTER_CHANGE_INTERVAL_HOURS: 8784,
      MIN_FILTER_CHANGE_INTERVAL_MONTHS: 3,
      MAX_FILTER_CHANGE_INTERVAL_MONTHS: 12,
      normalizeTargetTemperature: (value: number) => {
        const clamped = Math.max(10, Math.min(30, value));
        return Number((Math.round(clamped * 2) / 2).toFixed(1));
      },
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
      normalizeFreeCoolingTemperature: (value: unknown) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          throw new Error('Free cooling temperature must be numeric');
        }
        if (numeric < 10 || numeric > 30) {
          throw new Error('Free cooling temperature must be between 10 and 30 degC');
        }
        return Number((Math.round(numeric * 2) / 2).toFixed(1));
      },
      normalizeFreeCoolingMinOnTimeSeconds: (value: unknown) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          throw new Error('Free cooling minimum on-time must be numeric');
        }
        const rounded = Math.round(numeric);
        if (rounded < 0 || rounded > 18000) {
          throw new Error('Free cooling minimum on-time must be between 0 and 18000 seconds');
        }
        return rounded;
      },
      normalizeFanProfilePercent: (value: number, mode: string, fan: string) => {
        const rounded = Math.round(value);
        const ranges: Record<string, Record<string, { min: number; max: number }>> = {
          high: { supply: { min: 80, max: 100 }, exhaust: { min: 79, max: 100 } },
          home: { supply: { min: 56, max: 100 }, exhaust: { min: 55, max: 99 } },
          away: { supply: { min: 30, max: 80 }, exhaust: { min: 30, max: 79 } },
          fireplace: { supply: { min: 30, max: 100 }, exhaust: { min: 30, max: 100 } },
          cooker: { supply: { min: 30, max: 100 }, exhaust: { min: 30, max: 100 } },
        };
        const range = ranges[mode]?.[fan];
        if (!range) throw new Error(`Unsupported fan profile range ${mode}.${fan}`);
        if (rounded < range.min || rounded > range.max) {
          throw new Error(`${mode} ${fan} fan profile must be between ${range.min} and ${range.max} percent`);
        }
        return rounded;
      },
      filterIntervalMonthsToHours: (months: number) => Math.round(months * 732),
      filterIntervalHoursToMonths: (hours: number) => Math.max(3, Math.min(12, Math.round(hours / 732))),
    };
    for (const key of Object.keys(nordicDeviceMocks.unitRegistryModuleStub)) {
      delete nordicDeviceMocks.unitRegistryModuleStub[key];
    }
    Object.assign(nordicDeviceMocks.unitRegistryModuleStub, unitRegistryModuleStub);

    const mod = await import('../drivers/nordic/device.ts');
    DeviceClass = mod.default ?? mod;
  });

  afterEach(() => {
    sinon.restore();
  });

  it('adds exhaust capability during onInit when missing', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(false);
    device.hasCapability.withArgs(DEHUMIDIFICATION_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(FREE_COOLING_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);

    await device.onInit();

    expect(device.addCapability.calledOnceWithExactly(EXHAUST_TEMP_CAPABILITY)).toBe(true);
    expect(registryStub.register.calledOnceWithExactly('test_unit', device)).toBe(true);
  });

  it('does not add exhaust capability during onInit when already present', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(DEHUMIDIFICATION_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(FREE_COOLING_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);

    await device.onInit();

    expect(device.addCapability.called).toBe(false);
    expect(registryStub.register.calledOnceWithExactly('test_unit', device)).toBe(true);
  });

  it('adds dehumidification capability during onInit when missing', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(DEHUMIDIFICATION_ACTIVE_CAPABILITY).returns(false);
    device.hasCapability.withArgs(FREE_COOLING_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);

    await device.onInit();

    expect(device.addCapability.calledOnceWithExactly(DEHUMIDIFICATION_ACTIVE_CAPABILITY)).toBe(true);
    expect(registryStub.register.calledOnceWithExactly('test_unit', device)).toBe(true);
  });

  it('adds free cooling capability during onInit when missing', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(DEHUMIDIFICATION_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(FREE_COOLING_ACTIVE_CAPABILITY).returns(false);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);

    await device.onInit();

    expect(device.addCapability.calledOnceWithExactly(FREE_COOLING_ACTIVE_CAPABILITY)).toBe(true);
    expect(registryStub.register.calledOnceWithExactly('test_unit', device)).toBe(true);
  });

  it('logs capability migration errors and continues initialization', async () => {
    const device = new DeviceClass();
    const err = new Error('add failed');
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(false);
    device.hasCapability.withArgs(DEHUMIDIFICATION_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(FREE_COOLING_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    device.addCapability.rejects(err);

    await device.onInit();

    expect(device.error.called).toBe(true);
    expect(device.error.firstCall.args[0]).toBe(`Failed adding capability '${EXHAUST_TEMP_CAPABILITY}':`);
    expect(device.error.firstCall.args[1]).toBe(err);
    expect(registryStub.register.calledOnceWithExactly('test_unit', device)).toBe(true);
  });

  it('registers capability listeners and forwards updates to registry', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(DEHUMIDIFICATION_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);

    await device.onInit();

    expect(device.registerCapabilityListener.calledThrice).toBe(true);
    expect(device.registerCapabilityListener.firstCall.args[0]).toBe('target_temperature');
    expect(device.registerCapabilityListener.secondCall.args[0]).toBe('fan_mode');
    expect(device.registerCapabilityListener.thirdCall.args[0]).toBe(RESET_FILTER_CAPABILITY);

    const targetListener = device.registerCapabilityListener.firstCall.args[1];
    const fanModeListener = device.registerCapabilityListener.secondCall.args[1];
    const resetFilterListener = device.registerCapabilityListener.thirdCall.args[1];

    await targetListener(21.5);
    await fanModeListener('high');
    await resetFilterListener(true);

    expect(registryStub.writeSetpoint.calledOnceWithExactly('test_unit', 21.5)).toBe(true);
    expect(registryStub.setFanMode.calledOnceWithExactly('test_unit', 'high')).toBe(true);
    expect(registryStub.resetFilterTimer.calledOnceWithExactly('test_unit')).toBe(true);
  });

  it('logs capability write failures before rethrowing them', async () => {
    const device = new DeviceClass();
    const failure = new Error('registry write failed');
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(DEHUMIDIFICATION_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    registryStub.writeSetpoint.rejects(failure);

    await device.onInit();

    const targetListener = device.registerCapabilityListener.firstCall.args[1];
    let thrown: Error | null = null;
    try {
      await targetListener(21.5);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).toBe(
      'Failed writing setpoint 21.5 for Test Nordic (unit test_unit): registry write failed',
    );
    const failureLog = device.error.getCalls().find((call: any) => (
      String(call.args[0]).includes("Capability 'target_temperature' writing setpoint 21.5 failed after")
    ));
    expect(failureLog).not.toBe(undefined);
    expect(failureLog?.args[1]).toBe(failure);
  });

  it('surfaces descriptive timeout messages for capability writes', async () => {
    const device = new DeviceClass();
    const failure = new Error('Timeout') as Error & { code?: string };
    failure.code = 'ERR_TIMEOUT';
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(DEHUMIDIFICATION_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    device.getSetting.withArgs('ip').returns('192.168.88.32');
    registryStub.writeSetpoint.rejects(failure);

    await device.onInit();

    const targetListener = device.registerCapabilityListener.firstCall.args[1];
    let thrown: Error | null = null;
    try {
      await targetListener(16);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).toBe(
      'Timed out writing setpoint 16 for Test Nordic (unit test_unit, ip 192.168.88.32);'
      + ' the BACnet unit did not respond in time.',
    );
    const failureLog = device.error.getCalls().find((call: any) => (
      String(call.args[0]).includes("Capability 'target_temperature' writing setpoint 16 failed after")
    ));
    expect(failureLog).not.toBe(undefined);
    expect(failureLog?.args[1]).toBe(failure);
  });

  it('surfaces object-like thrown values with structured details', async () => {
    const device = new DeviceClass();
    const failure = { reason: 'device busy', retryable: true };
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(DEHUMIDIFICATION_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    registryStub.writeSetpoint.rejects(failure);

    await device.onInit();

    const targetListener = device.registerCapabilityListener.firstCall.args[1];
    let thrown: Error | null = null;
    try {
      await targetListener(19);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).toBe(
      'Failed writing setpoint 19 for Test Nordic (unit test_unit):'
      + ' {"reason":"device busy","retryable":true}',
    );
    const failureLog = device.error.getCalls().find((call: any) => (
      String(call.args[0]).includes("Capability 'target_temperature' writing setpoint 19 failed after")
    ));
    expect(failureLog).not.toBe(undefined);
    expect(failureLog?.args[1]).toBe(failure);
  });

  it('logs slow capability writes before callers time out', async () => {
    const clock = sinon.useFakeTimers();
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(DEHUMIDIFICATION_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);

    let resolveWrite: (() => void) | undefined;
    registryStub.writeSetpoint.callsFake(() => new Promise<void>((resolve) => {
      resolveWrite = resolve;
    }));

    try {
      await device.onInit();

      const targetListener = device.registerCapabilityListener.firstCall.args[1];
      const listenerPromise = targetListener(21.5);

      await clock.tickAsync(4999);
      expect(device.error.called).toBe(false);

      await clock.tickAsync(1);
      const pendingLog = device.error.getCalls().find((call: any) => (
        String(call.args[0]).includes(
          "Capability 'target_temperature' writing setpoint 21.5 is still pending after 5000ms",
        )
      ));
      expect(pendingLog).not.toBe(undefined);

      resolveWrite?.();
      await clock.tickAsync(0);
      await listenerPromise;

      const completionLog = device.log.getCalls().find((call: any) => (
        String(call.args[0]).includes("Capability 'target_temperature' writing setpoint 21.5 completed after 5000ms")
      ));
      expect(completionLog).not.toBe(undefined);
    } finally {
      clock.restore();
    }
  });

  it('logs slow completion based on elapsed time even when timer callback is delayed', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(DEHUMIDIFICATION_ACTIVE_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);

    const setTimeoutStub = sinon.stub(global, 'setTimeout').callsFake((_fn: any) => 1 as any);
    const clearTimeoutStub = sinon.stub(global, 'clearTimeout').callsFake(() => undefined as any);
    const dateNowStub = sinon.stub(Date, 'now');
    dateNowStub.onFirstCall().returns(1_000);
    dateNowStub.onSecondCall().returns(7_000);

    try {
      await device.onInit();
      const targetListener = device.registerCapabilityListener.firstCall.args[1];
      await targetListener(21.5);

      const pendingLog = device.error.getCalls().find((call: any) => (
        String(call.args[0]).includes(
          "Capability 'target_temperature' writing setpoint 21.5 is still pending after 6000ms",
        )
      ));
      expect(pendingLog).not.toBe(undefined);

      const completionLog = device.log.getCalls().find((call: any) => (
        String(call.args[0]).includes("Capability 'target_temperature' writing setpoint 21.5 completed after 6000ms")
      ));
      expect(completionLog).not.toBe(undefined);
      expect(setTimeoutStub.called).toBe(true);
      expect(clearTimeoutStub.called).toBe(true);
    } finally {
      setTimeoutStub.restore();
      clearTimeoutStub.restore();
      dateNowStub.restore();
    }
  });

  it('normalizes legacy numeric connection label settings during init', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    device.getSetting.withArgs('ip').returns('192.0.2.10');
    device.getSetting.withArgs('bacnetPort').returns(47808);
    device.getSetting.withArgs('serial').returns('800131-000001');
    device.getSetting.withArgs('mac').returns('02:00:00:00:00:01');

    await device.onInit();

    expect(device.setSettings.calledOnceWithExactly({ bacnetPort: '47808' })).toBe(true);
  });

  it('continues initialization when legacy label normalization fails', async () => {
    const device = new DeviceClass();
    const normalizationError = new Error('settings unavailable');
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    device.getSetting.withArgs('ip').returns('192.0.2.10');
    device.getSetting.withArgs('bacnetPort').returns(47808);
    device.getSetting.withArgs('serial').returns('800131-000001');
    device.getSetting.withArgs('mac').returns('02:00:00:00:00:01');
    device.setSettings.rejects(normalizationError);

    await device.onInit();

    expect(device.error.called).toBe(true);
    expect(
      device.error.calledWith(
        'Failed to normalize legacy connection settings:',
        normalizationError,
        { bacnetPort: '47808' },
      ),
    ).toBe(true);
    expect(registryStub.register.calledOnceWithExactly('test_unit', device)).toBe(true);
  });

  it('unregisters device on deletion', async () => {
    const device = new DeviceClass();

    await device.onDeleted();

    expect(registryStub.unregister.calledOnceWithExactly('test_unit', device)).toBe(true);
  });

  it('accepts month bounds 3..12 for filter change interval', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    await device.onInit();

    await device.onSettings({
      newSettings: { filter_change_interval_months: 3 },
      changedKeys: ['filter_change_interval_months'],
    });
    await device.onSettings({
      newSettings: { filter_change_interval_months: 12 },
      changedKeys: ['filter_change_interval_months'],
    });

    expect(registryStub.setFilterChangeInterval.firstCall.args).toEqual(['test_unit', 2196]);
    expect(registryStub.setFilterChangeInterval.secondCall.args).toEqual(['test_unit', 8784]);
  });

  it('skips filter interval write when requested settings are already in sync', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    device.getSetting.withArgs('filter_change_interval_months').returns(6);
    device.getSetting.withArgs('filter_change_interval_hours').returns(4392);
    await device.onInit();

    await device.onSettings({
      newSettings: { filter_change_interval_months: 6 },
      changedKeys: ['filter_change_interval_months'],
    });

    expect(registryStub.setFilterChangeInterval.called).toBe(false);
  });

  it('accepts legacy hour-based filter interval settings for backward compatibility', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    await device.onInit();

    await device.onSettings({
      newSettings: { filter_change_interval_hours: 5000 },
      changedKeys: ['filter_change_interval_hours'],
    });

    expect(registryStub.setFilterChangeInterval.calledOnceWithExactly('test_unit', 5000)).toBe(true);
  });

  it('rejects month values outside 3..12', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    await device.onInit();

    let thrownLow: Error | null = null;
    try {
      await device.onSettings({
        newSettings: { filter_change_interval_months: 2 },
        changedKeys: ['filter_change_interval_months'],
      });
    } catch (error) {
      thrownLow = error as Error;
    }
    let thrownHigh: Error | null = null;
    try {
      await device.onSettings({
        newSettings: { filter_change_interval_months: 13 },
        changedKeys: ['filter_change_interval_months'],
      });
    } catch (error) {
      thrownHigh = error as Error;
    }

    expect(thrownLow).not.toBe(null);
    expect(thrownHigh).not.toBe(null);
    expect(thrownLow?.message).toContain('between 3 and 12 months');
    expect(thrownHigh?.message).toContain('between 3 and 12 months');
    expect(registryStub.setFilterChangeInterval.called).toBe(false);
  });

  it('writes changed home and away target temperatures from settings with 0.5C normalization', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    device.getSetting.withArgs('target_temperature_home').returns(20);
    device.getSetting.withArgs('target_temperature_away').returns(18);
    await device.onInit();

    await device.onSettings({
      newSettings: {
        target_temperature_home: 21.26,
        target_temperature_away: 17.24,
      },
      changedKeys: ['target_temperature_home', 'target_temperature_away'],
    });

    expect(registryStub.setTemperatureSetpoint.firstCall.args).toEqual(['test_unit', 'home', 21.5]);
    expect(registryStub.setTemperatureSetpoint.secondCall.args).toEqual(['test_unit', 'away', 17]);
  });

  it('rejects out-of-range target temperature settings', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    await device.onInit();

    let thrown: Error | null = null;
    try {
      await device.onSettings({
        newSettings: {
          target_temperature_home: 31,
        },
        changedKeys: ['target_temperature_home'],
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).not.toBe(null);
    expect(thrown?.message).toContain('between 10 and 30');
    expect(registryStub.setTemperatureSetpoint.called).toBe(false);
  });

  it('writes free cooling settings through the shared settings handler', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    device.getSetting.withArgs('free_cooling_enabled').returns(false);
    device.getSetting.withArgs('free_cooling_extract_temp_setpoint').returns(22);
    device.getSetting.withArgs('free_cooling_outside_temp_limit').returns(18);
    device.getSetting.withArgs('free_cooling_min_on_time_seconds').returns(600);
    await device.onInit();

    await device.onSettings({
      newSettings: {
        free_cooling_enabled: true,
        free_cooling_extract_temp_setpoint: 21.26,
        free_cooling_outside_temp_limit: 17.74,
        free_cooling_min_on_time_seconds: 900.2,
      },
      changedKeys: [
        'free_cooling_enabled',
        'free_cooling_extract_temp_setpoint',
        'free_cooling_outside_temp_limit',
        'free_cooling_min_on_time_seconds',
      ],
    });

    expect(registryStub.setFreeCoolingEnabled.calledOnceWithExactly('test_unit', true)).toBe(true);
    expect(
      registryStub.setFreeCoolingTemperatureSetpoint.calledOnceWithExactly('test_unit', 21.5),
    ).toBe(true);
    expect(
      registryStub.setFreeCoolingOutsideTemperatureLimit.calledOnceWithExactly('test_unit', 17.5),
    ).toBe(true);
    expect(
      registryStub.setFreeCoolingMinOnTimeSeconds.calledOnceWithExactly('test_unit', 900),
    ).toBe(true);
  });

  it('rejects out-of-range free cooling settings', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    await device.onInit();

    let thrownTemperature: Error | null = null;
    try {
      await device.onSettings({
        newSettings: { free_cooling_extract_temp_setpoint: 31 },
        changedKeys: ['free_cooling_extract_temp_setpoint'],
      });
    } catch (error) {
      thrownTemperature = error as Error;
    }

    let thrownRuntime: Error | null = null;
    try {
      await device.onSettings({
        newSettings: { free_cooling_min_on_time_seconds: 18001 },
        changedKeys: ['free_cooling_min_on_time_seconds'],
      });
    } catch (error) {
      thrownRuntime = error as Error;
    }

    expect(thrownTemperature?.message).toContain('between 10 and 30');
    expect(thrownRuntime?.message).toContain('between 0 and 18000 seconds');
    expect(registryStub.setFreeCoolingTemperatureSetpoint.called).toBe(false);
    expect(registryStub.setFreeCoolingMinOnTimeSeconds.called).toBe(false);
  });

  it('writes changed fan profile settings by mode', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    device.getSetting.withArgs('fan_profile_home_supply').returns(80);
    device.getSetting.withArgs('fan_profile_home_exhaust').returns(79);
    await device.onInit();

    await device.onSettings({
      newSettings: {
        fan_profile_home_supply: 70,
        fan_profile_home_exhaust: 60,
      },
      changedKeys: ['fan_profile_home_supply'],
    });

    expect(registryStub.setFanProfileMode.calledOnceWithExactly('test_unit', 'home', 70, 60)).toBe(true);
  });

  it('writes changed fireplace duration setting in minutes', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    device.getSetting.withArgs('fireplace_duration_minutes').returns(10);
    await device.onInit();

    await device.onSettings({
      newSettings: {
        fireplace_duration_minutes: 25,
      },
      changedKeys: ['fireplace_duration_minutes'],
    });

    expect(registryStub.setFireplaceVentilationDuration.calledOnceWithExactly('test_unit', 25)).toBe(true);
  });

  it('rejects fireplace duration outside supported range', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    await device.onInit();

    let thrown: Error | null = null;
    try {
      await device.onSettings({
        newSettings: {
          fireplace_duration_minutes: 361,
        },
        changedKeys: ['fireplace_duration_minutes'],
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).not.toBe(null);
    expect(thrown?.message).toContain('between 1 and 360 minutes');
    expect(registryStub.setFireplaceVentilationDuration.called).toBe(false);
  });

  it('defers registry setting updates until onSettings is complete', async () => {
    const clock = sinon.useFakeTimers();
    const device = new DeviceClass();
    try {
      device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
      device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
      device.getSetting.withArgs('fireplace_duration_minutes').returns(10);
      device.setSettings.callsFake(async () => {
        if ((device as any).settingsUpdateInProgress) {
          throw new Error('Cannot set Settings while this.onSettings is still pending');
        }
      });
      registryStub.setFireplaceVentilationDuration.callsFake(async (_unitId: string, duration: number) => {
        await device.applyRegistrySettings({ fireplace_duration_minutes: duration });
      });
      await device.onInit();

      await device.onSettings({
        newSettings: {
          fireplace_duration_minutes: 30,
        },
        changedKeys: ['fireplace_duration_minutes'],
      });

      await clock.tickAsync(0);

      expect(registryStub.setFireplaceVentilationDuration.calledOnceWithExactly('test_unit', 30)).toBe(true);
      expect(device.setSettings.calledOnceWithExactly({ fireplace_duration_minutes: 30 })).toBe(true);
      expect(
        device.error.calledWithMatch(
          'Failed to apply deferred registry settings:',
        ),
      ).toBe(false);
    } finally {
      clock.restore();
    }
  });

  it('re-queues deferred registry settings when apply fails', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    await device.onInit();

    const transientFailure = new Error('setSettings failed');
    device.setSettings.onFirstCall().rejects(transientFailure);
    device.setSettings.onSecondCall().resolves();

    (device as any).settingsUpdateInProgress = true;
    await device.applyRegistrySettings({ fireplace_duration_minutes: 40 });
    (device as any).settingsUpdateInProgress = false;

    await (device as any).flushDeferredRegistrySettings();
    expect(device.setSettings.calledOnceWithExactly({ fireplace_duration_minutes: 40 })).toBe(true);
    expect((device as any).deferredRegistrySettings).toEqual({ fireplace_duration_minutes: 40 });

    await (device as any).flushDeferredRegistrySettings();
    expect(device.setSettings.calledTwice).toBe(true);
    expect((device as any).deferredRegistrySettings).toEqual({});
  });

  it('suppresses onSettings fan profile writes for registry-originated sync', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    device.getSetting.withArgs('fan_profile_home_supply').returns(80);
    device.getSetting.withArgs('fan_profile_home_exhaust').returns(79);
    await device.onInit();

    await device.applyRegistrySettings({
      fan_profile_home_supply: 70,
      fan_profile_home_exhaust: 60,
    });

    await device.onSettings({
      newSettings: {
        fan_profile_home_supply: 70,
        fan_profile_home_exhaust: 60,
      },
      changedKeys: ['fan_profile_home_supply', 'fan_profile_home_exhaust'],
    });

    expect(registryStub.setFanProfileMode.called).toBe(false);
  });

  it('rejects out-of-range fan profile values', async () => {
    const device = new DeviceClass();
    device.hasCapability.withArgs(EXHAUST_TEMP_CAPABILITY).returns(true);
    device.hasCapability.withArgs(RESET_FILTER_CAPABILITY).returns(true);
    await device.onInit();

    let thrown: Error | null = null;
    try {
      await device.onSettings({
        newSettings: {
          fan_profile_home_supply: 101,
          fan_profile_home_exhaust: 60,
        },
        changedKeys: ['fan_profile_home_supply'],
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).not.toBe(null);
    expect(thrown?.message).toContain('between 56 and 100');
    expect(registryStub.setFanProfileMode.called).toBe(false);
  });
});
