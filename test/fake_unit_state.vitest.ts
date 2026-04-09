/* eslint-disable import/extensions */
import { describe, expect, it } from 'vitest';

import {
  APPLICATION_TAG,
  DEFAULT_DEVICE_NAME,
  DEFAULT_FIRMWARE,
  DEFAULT_MODEL_NAME,
  DEFAULT_POINT_VALUES,
  DEFAULT_VENDOR_ID,
  DEFAULT_VENDOR_NAME,
  OBJECT_TYPE,
  OPERATION_MODE_VALUES,
  PROPERTY_ID,
  SUPPORTED_POINTS,
  pointKey,
} from '../scripts/fake-unit/manifest.ts';
import {
  FakeNordicUnitState,
  valueTagForRead,
  valueToWriteNumber,
} from '../scripts/fake-unit/state.ts';

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
    timeScale: 60,
  });
}

function pointByName(name: string) {
  const point = SUPPORTED_POINTS.find((candidate) => candidate.name === name);
  expect(point).not.toBe(undefined);
  return point!;
}

describe('fake-unit state', () => {
  it('encodes MSV presentValue as unsigned integer', () => {
    const msvPoint = SUPPORTED_POINTS.find(
      (point) => point.type === OBJECT_TYPE.MULTI_STATE_VALUE && point.instance === 42,
    );
    expect(msvPoint).not.toBe(undefined);
    expect(valueTagForRead(msvPoint!)).toBe(APPLICATION_TAG.UNSIGNED_INTEGER);
  });

  it('keeps BV enum points encoded as enumerated', () => {
    const comfortBvPoint = SUPPORTED_POINTS.find(
      (point) => point.type === OBJECT_TYPE.BINARY_VALUE && point.instance === 50,
    );
    const heatingCoilBvPoint = SUPPORTED_POINTS.find(
      (point) => point.type === OBJECT_TYPE.BINARY_VALUE && point.instance === 445,
    );
    expect(comfortBvPoint).not.toBe(undefined);
    expect(heatingCoilBvPoint).not.toBe(undefined);
    expect(valueTagForRead(comfortBvPoint!)).toBe(APPLICATION_TAG.ENUMERATED);
    expect(valueTagForRead(heatingCoilBvPoint!)).toBe(APPLICATION_TAG.ENUMERATED);
  });

  it('accepts heating coil writes on BV:445 with priority 13/16 and rejects invalid explicit priorities', () => {
    const state = createState();

    const priority13Write = state.writePresentValue(
      OBJECT_TYPE.BINARY_VALUE,
      445,
      PROPERTY_ID.PRESENT_VALUE,
      0,
      13,
    );
    expect(priority13Write.ok).toBe(true);

    const priority16Write = state.writePresentValue(
      OBJECT_TYPE.BINARY_VALUE,
      445,
      PROPERTY_ID.PRESENT_VALUE,
      1,
      16,
    );
    expect(priority16Write.ok).toBe(true);

    const denied = state.writePresentValue(
      OBJECT_TYPE.BINARY_VALUE,
      445,
      PROPERTY_ID.PRESENT_VALUE,
      0,
      12,
    );
    expect(denied.ok).toBe(false);
  });

  it('accepts missing priority and GO compatibility priority while rejecting invalid explicit priorities', () => {
    const state = createState();
    const missingPriorityAllowed = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      1994,
      PROPERTY_ID.PRESENT_VALUE,
      21,
    );
    expect(missingPriorityAllowed.ok).toBe(true);

    const goPriorityAllowed = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      1994,
      PROPERTY_ID.PRESENT_VALUE,
      21,
      16,
    );
    expect(goPriorityAllowed.ok).toBe(true);

    const denied = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      1994,
      PROPERTY_ID.PRESENT_VALUE,
      21,
      12,
    );
    expect(denied.ok).toBe(false);

    const allowed = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      1994,
      PROPERTY_ID.PRESENT_VALUE,
      21,
      13,
    );
    expect(allowed.ok).toBe(true);
  });

  it('supports mode switching and summary rendering', () => {
    const state = createState();
    const result = state.setFanMode('high');
    expect(result.ok).toBe(true);

    const summary = state.summary();
    expect(summary.mode).toBe('high');
    expect(summary.fan.supplyPercent).toBeGreaterThan(90);
  });

  it('supports filter maintenance operations', () => {
    const state = createState();
    expect(state.setFilterLimitHours(5000).ok).toBe(true);
    expect(state.setFilterOperatingHours(1000).ok).toBe(true);

    const before = state.getFilterStatus();
    expect(before.limitHours).toBe(5000);
    expect(before.operatingHours).toBe(1000);

    expect(state.replaceFilter().ok).toBe(true);
    const after = state.getFilterStatus();
    expect(after.operatingHours).toBe(0);
  });

  it('resets filter operating time through filter reset trigger points', () => {
    const state = createState();
    expect(state.setFilterOperatingHours(1000).ok).toBe(true);

    const primaryReset = state.writePresentValue(
      OBJECT_TYPE.MULTI_STATE_VALUE,
      613,
      PROPERTY_ID.PRESENT_VALUE,
      2,
      13,
    );
    expect(primaryReset.ok).toBe(true);
    expect(state.getFilterStatus().operatingHours).toBe(0);

    expect(state.setFilterOperatingHours(500).ok).toBe(true);
    const legacyReset = state.writePresentValue(
      OBJECT_TYPE.MULTI_STATE_VALUE,
      609,
      PROPERTY_ID.PRESENT_VALUE,
      2,
      13,
    );
    expect(legacyReset.ok).toBe(true);
    expect(state.getFilterStatus().operatingHours).toBe(0);
  });

  it('accepts observed Flexit GO compatibility reset write for AV:285', () => {
    const state = createState();
    expect(state.setFilterOperatingHours(220).ok).toBe(true);

    const goResetWrite = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      285,
      PROPERTY_ID.PRESENT_VALUE,
      0,
      16,
    );
    expect(goResetWrite.ok).toBe(true);
    expect(state.getFilterStatus().operatingHours).toBe(0);

    const nonZeroDenied = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      285,
      PROPERTY_ID.PRESENT_VALUE,
      50,
      16,
    );
    expect(nonZeroDenied.ok).toBe(false);
  });

  it('accepts fan profile writes on AV 1836/1841 with priority 16', () => {
    const state = createState();
    const writeHomeSupply = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      1836,
      PROPERTY_ID.PRESENT_VALUE,
      70,
      16,
    );
    const writeHomeExhaust = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      1841,
      PROPERTY_ID.PRESENT_VALUE,
      60,
      16,
    );

    expect(writeHomeSupply.ok).toBe(true);
    expect(writeHomeExhaust.ok).toBe(true);
    state.setFanMode('home');
    const summary = state.summary();
    expect(summary.fan.supplyPercent).toBe(70);
    expect(summary.fan.extractPercent).toBe(60);
  });

  it('reports read errors for unsupported properties, objects, and missing values', () => {
    const state = createState();

    const unsupportedProperty = state.readPresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      1994,
      PROPERTY_ID.MIN_PRESENT_VALUE,
    );
    expect(unsupportedProperty.ok).toBe(false);

    const unknownObject = state.readPresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      999999,
      PROPERTY_ID.PRESENT_VALUE,
    );
    expect(unknownObject.ok).toBe(false);

    const setpointHome = pointByName('setpoint_home');
    (state as any).values.delete(pointKey(setpointHome.type, setpointHome.instance));
    const missingValue = state.readPresentValue(
      setpointHome.type,
      setpointHome.instance,
      PROPERTY_ID.PRESENT_VALUE,
    );
    expect(missingValue.ok).toBe(false);
  });

  it('rejects invalid writes for type, property, object, access, and range', () => {
    const state = createState();

    expect(
      state.writePresentValue(OBJECT_TYPE.ANALOG_VALUE, 1994, PROPERTY_ID.PRESENT_VALUE, Number.NaN).ok,
    ).toBe(false);
    expect(
      state.writePresentValue(OBJECT_TYPE.ANALOG_VALUE, 1994, PROPERTY_ID.MIN_PRESENT_VALUE, 20).ok,
    ).toBe(false);
    expect(
      state.writePresentValue(OBJECT_TYPE.ANALOG_VALUE, 999999, PROPERTY_ID.PRESENT_VALUE, 20).ok,
    ).toBe(false);
    expect(
      state.writePresentValue(OBJECT_TYPE.ANALOG_INPUT, 4, PROPERTY_ID.PRESENT_VALUE, 20, 13).ok,
    ).toBe(false);
    expect(
      state.writePresentValue(OBJECT_TYPE.ANALOG_VALUE, 1994, PROPERTY_ID.PRESENT_VALUE, 200, 13).ok,
    ).toBe(false);
  });

  it('fails fan mode changes when required points are missing or the first write fails', () => {
    const missingAwayState = createState();
    (missingAwayState as any).pointsByName.delete('comfort_button');
    expect(missingAwayState.setFanMode('away').ok).toBe(false);

    const missingHomeState = createState();
    (missingHomeState as any).pointsByName.delete('ventilation_mode');
    expect(missingHomeState.setFanMode('home').ok).toBe(false);
    expect(missingHomeState.setFanMode('high').ok).toBe(false);

    const missingFireplaceState = createState();
    (missingFireplaceState as any).pointsByName.delete('trigger_fireplace');
    expect(missingFireplaceState.setFanMode('fireplace').ok).toBe(false);

    const failingWriteState = createState();
    const comfortButton = pointByName('comfort_button');
    const originalWrite = failingWriteState.writePresentValue.bind(failingWriteState);
    (failingWriteState as any).writePresentValue = (
      type: number,
      instance: number,
      propertyId: number,
      value: number,
      priority?: number,
    ) => {
      if (type === comfortButton.type && instance === comfortButton.instance && value === 1) {
        return {
          ok: false,
          errorClass: 1,
          errorCode: 31,
          message: 'forced failure',
        };
      }
      return originalWrite(type, instance, propertyId, value, priority);
    };

    expect(failingWriteState.setFanMode('home').ok).toBe(false);
    expect(failingWriteState.setFanMode('high').ok).toBe(false);
    expect(failingWriteState.setFanMode('invalid' as any).ok).toBe(false);
  });

  it('fails setpoint writes when the underlying points are missing', () => {
    const state = createState();
    (state as any).pointsByName.delete('setpoint_home');
    (state as any).pointsByName.delete('setpoint_away');
    expect(state.setHomeSetpoint(20).ok).toBe(false);
    expect(state.setAwaySetpoint(18).ok).toBe(false);
  });

  it('starts rapid and fireplace timers with default and explicit runtime handling', () => {
    const state = createState();

    expect(state.startRapid().ok).toBe(true);
    expect(state.summary().timers.rapidMinutes).toBeGreaterThan(0);

    expect(state.startFireplace().ok).toBe(true);
    expect(state.summary().timers.fireplaceMinutes).toBeGreaterThan(0);

    expect(state.startRapid(9999).ok).toBe(false);
    expect(state.startFireplace(9999).ok).toBe(false);
    expect(state.advanceSimulatedSeconds(0)).toBe(undefined);
  });

  it('reports configured runtimes on inactive temporary ventilation points', () => {
    const state = createState();

    const remainingRapid = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 2031, PROPERTY_ID.PRESENT_VALUE);
    const remainingFireplace = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 2038, PROPERTY_ID.PRESENT_VALUE);
    const remainingTempVent = state.readPresentValue(OBJECT_TYPE.ANALOG_VALUE, 2005, PROPERTY_ID.PRESENT_VALUE);

    if (!remainingRapid.ok || !remainingFireplace.ok || !remainingTempVent.ok) {
      throw new Error('Expected temporary ventilation points to be readable');
    }

    expect(state.summary().mode).toBe('home');
    expect(state.summary().timers.rapidMinutes).toBe(0);
    expect(remainingRapid.value.value).toBe(10);
    expect(remainingFireplace.value.value).toBe(10);
    expect(remainingTempVent.value.value).toBe(0);
  });

  it('tracks away delay and the observed rapid/fireplace trigger sequence', () => {
    const state = createState();
    const rapidRuntime = pointByName('runtime_rapid');
    const rapidTrigger = pointByName('trigger_rapid');
    const fireplaceRuntime = pointByName('runtime_fireplace');
    const fireplaceTrigger = pointByName('trigger_fireplace');

    expect(
      state.writePresentValue(OBJECT_TYPE.BINARY_VALUE, 50, PROPERTY_ID.PRESENT_VALUE, 0, 13).ok,
    ).toBe(true);
    expect(state.summary().timers.awayDelayMinutes).toBeGreaterThan(0);

    expect(
      state.writePresentValue(OBJECT_TYPE.BINARY_VALUE, 50, PROPERTY_ID.PRESENT_VALUE, 1, 13).ok,
    ).toBe(true);
    expect(state.summary().timers.awayDelayMinutes).toBe(0);

    expect(
      state.writePresentValue(
        rapidRuntime.type,
        rapidRuntime.instance,
        PROPERTY_ID.PRESENT_VALUE,
        12,
        13,
      ).ok,
    ).toBe(true);
    expect(
      state.writePresentValue(
        rapidTrigger.type,
        rapidTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        13,
      ).ok,
    ).toBe(true);
    expect(state.summary().timers.rapidMinutes).toBeGreaterThan(0);

    expect(
      state.writePresentValue(
        fireplaceRuntime.type,
        fireplaceRuntime.instance,
        PROPERTY_ID.PRESENT_VALUE,
        18,
        13,
      ).ok,
    ).toBe(true);
    expect(
      state.writePresentValue(
        fireplaceTrigger.type,
        fireplaceTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        13,
      ).ok,
    ).toBe(true);
    expect(state.summary().timers.rapidMinutes).toBe(0);
    expect(state.summary().mode).toBe('fireplace');
    expect(state.summary().timers.fireplaceMinutes).toBeGreaterThan(0);
  });

  it('only enters fireplace after rapid ventilation has been cleared', () => {
    const state = createState();
    const rapidTrigger = pointByName('trigger_rapid');
    const fireplaceRuntime = pointByName('runtime_fireplace');
    const fireplaceTrigger = pointByName('trigger_fireplace');

    expect(state.startRapid(10).ok).toBe(true);
    expect(state.summary().mode).toBe('high');

    expect(
      state.writePresentValue(
        fireplaceRuntime.type,
        fireplaceRuntime.instance,
        PROPERTY_ID.PRESENT_VALUE,
        18,
        16,
      ).ok,
    ).toBe(true);
    expect(
      state.writePresentValue(
        fireplaceTrigger.type,
        fireplaceTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        16,
      ).ok,
    ).toBe(true);
    expect(state.summary().mode).toBe('high');
    expect(state.summary().timers.fireplaceMinutes).toBe(18);

    expect(
      state.writePresentValue(
        rapidTrigger.type,
        rapidTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        16,
      ).ok,
    ).toBe(true);
    expect(state.summary().timers.rapidMinutes).toBe(0);

    expect(
      state.writePresentValue(
        fireplaceRuntime.type,
        fireplaceRuntime.instance,
        PROPERTY_ID.PRESENT_VALUE,
        18,
        16,
      ).ok,
    ).toBe(true);
    expect(
      state.writePresentValue(
        fireplaceTrigger.type,
        fireplaceTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        16,
      ).ok,
    ).toBe(true);
    expect(state.summary().mode).toBe('fireplace');
    expect(state.summary().timers.fireplaceMinutes).toBeGreaterThan(0);
  });

  it('does not enter fireplace on rapid/fireplace trigger sequence without a fresh fireplace runtime write', () => {
    const state = createState();
    const rapidTrigger = pointByName('trigger_rapid');
    const fireplaceTrigger = pointByName('trigger_fireplace');

    expect(
      state.writePresentValue(
        rapidTrigger.type,
        rapidTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        13,
      ).ok,
    ).toBe(true);
    expect(
      state.writePresentValue(
        fireplaceTrigger.type,
        fireplaceTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        13,
      ).ok,
    ).toBe(true);

    const summary = state.summary();
    expect(summary.mode).toBe('high');
    expect(summary.timers.fireplaceMinutes).toBe(10);
    expect(summary.timers.rapidMinutes).toBeGreaterThan(0);
  });

  it('toggles fireplace ventilation off when re-triggered while already active', () => {
    const state = createState();
    const fireplaceRuntime = pointByName('runtime_fireplace');
    const fireplaceTrigger = pointByName('trigger_fireplace');

    expect(
      state.writePresentValue(
        fireplaceRuntime.type,
        fireplaceRuntime.instance,
        PROPERTY_ID.PRESENT_VALUE,
        18,
        13,
      ).ok,
    ).toBe(true);
    expect(
      state.writePresentValue(
        fireplaceTrigger.type,
        fireplaceTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        13,
      ).ok,
    ).toBe(true);

    const activeSummary = state.summary();
    expect(activeSummary.mode).toBe('fireplace');
    expect(activeSummary.timers.fireplaceMinutes).toBeCloseTo(18, 0.1);

    state.advanceSimulatedSeconds(60);
    const activeRemaining = state.summary().timers.fireplaceMinutes;
    expect(activeRemaining).toBeLessThan(17.5);

    expect(
      state.writePresentValue(
        fireplaceTrigger.type,
        fireplaceTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        13,
      ).ok,
    ).toBe(true);

    const inactiveSummary = state.summary();
    expect(inactiveSummary.mode).toBe('home');
    expect(inactiveSummary.timers.fireplaceMinutes).toBeCloseTo(18, 0.1);

    const inactiveRemainingFireplace = state.readPresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      2038,
      PROPERTY_ID.PRESENT_VALUE,
    );
    const fireplaceActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 400, PROPERTY_ID.PRESENT_VALUE);
    const operationMode = state.readPresentValue(OBJECT_TYPE.MULTI_STATE_VALUE, 361, PROPERTY_ID.PRESENT_VALUE);
    if (!inactiveRemainingFireplace.ok || !fireplaceActive.ok || !operationMode.ok) {
      throw new Error('Expected fireplace runtime and mode points to be readable');
    }
    expect(inactiveRemainingFireplace.value.value).toBe(18);
    expect(fireplaceActive.value.value).toBe(0);
    expect(operationMode.value.value).toBe(OPERATION_MODE_VALUES.HOME);

    state.advanceSimulatedSeconds(60);
    expect(state.summary().timers.fireplaceMinutes).toBeCloseTo(inactiveSummary.timers.fireplaceMinutes, 0.05);

    expect(
      state.writePresentValue(
        fireplaceRuntime.type,
        fireplaceRuntime.instance,
        PROPERTY_ID.PRESENT_VALUE,
        18,
        13,
      ).ok,
    ).toBe(true);
    expect(
      state.writePresentValue(
        fireplaceTrigger.type,
        fireplaceTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        13,
      ).ok,
    ).toBe(true);
    expect(state.summary().mode).toBe('fireplace');
  });

  it('keeps fireplace ventilation active when startFireplace is called repeatedly', () => {
    const state = createState();

    expect(state.startFireplace(18).ok).toBe(true);
    expect(state.summary().mode).toBe('fireplace');
    expect(state.summary().timers.fireplaceMinutes).toBeCloseTo(18, 0.1);

    state.advanceSimulatedSeconds(60);
    const activeRemaining = state.summary().timers.fireplaceMinutes;
    expect(activeRemaining).toBeLessThan(17.5);

    expect(state.startFireplace(12).ok).toBe(true);

    const summary = state.summary();
    expect(summary.mode).toBe('fireplace');
    expect(summary.timers.fireplaceMinutes).toBeCloseTo(12, 0.1);

    const fireplaceActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 400, PROPERTY_ID.PRESENT_VALUE);
    const operationMode = state.readPresentValue(OBJECT_TYPE.MULTI_STATE_VALUE, 361, PROPERTY_ID.PRESENT_VALUE);
    if (!fireplaceActive.ok || !operationMode.ok) {
      throw new Error('Expected fireplace active and operation mode points to be readable');
    }
    expect(fireplaceActive.value.value).toBe(1);
    expect(operationMode.value.value).toBe(OPERATION_MODE_VALUES.FIREPLACE);
  });

  it('does not infer fireplace mode from stale remaining runtime on startup', () => {
    const remainingFireplaceKey = pointKey(OBJECT_TYPE.ANALOG_VALUE, 2038);
    const runtimeFireplaceKey = pointKey(OBJECT_TYPE.POSITIVE_INTEGER_VALUE, 270);
    const fireplaceActiveKey = pointKey(OBJECT_TYPE.BINARY_VALUE, 400);
    const operationModeKey = pointKey(OBJECT_TYPE.MULTI_STATE_VALUE, 361);
    const originalRemainingFireplace = DEFAULT_POINT_VALUES[remainingFireplaceKey];
    const originalRuntimeFireplace = DEFAULT_POINT_VALUES[runtimeFireplaceKey];
    const originalFireplaceActive = DEFAULT_POINT_VALUES[fireplaceActiveKey];
    const originalOperationMode = DEFAULT_POINT_VALUES[operationModeKey];

    DEFAULT_POINT_VALUES[remainingFireplaceKey] = 18;
    DEFAULT_POINT_VALUES[runtimeFireplaceKey] = 18;
    DEFAULT_POINT_VALUES[fireplaceActiveKey] = 0;
    DEFAULT_POINT_VALUES[operationModeKey] = OPERATION_MODE_VALUES.HOME;

    try {
      const state = createState();
      const summary = state.summary();

      expect(summary.mode).toBe('home');
      expect(summary.timers.fireplaceMinutes).toBeCloseTo(18, 0.1);

      const fireplaceActive = state.readPresentValue(
        OBJECT_TYPE.BINARY_VALUE,
        400,
        PROPERTY_ID.PRESENT_VALUE,
      );
      const operationMode = state.readPresentValue(
        OBJECT_TYPE.MULTI_STATE_VALUE,
        361,
        PROPERTY_ID.PRESENT_VALUE,
      );

      if (!fireplaceActive.ok || !operationMode.ok) {
        throw new Error('Expected fireplace active and operation mode points to be readable');
      }

      expect(fireplaceActive.value.value).toBe(0);
      expect(operationMode.value.value).toBe(OPERATION_MODE_VALUES.HOME);
    } finally {
      DEFAULT_POINT_VALUES[remainingFireplaceKey] = originalRemainingFireplace;
      DEFAULT_POINT_VALUES[runtimeFireplaceKey] = originalRuntimeFireplace;
      DEFAULT_POINT_VALUES[fireplaceActiveKey] = originalFireplaceActive;
      DEFAULT_POINT_VALUES[operationModeKey] = originalOperationMode;
    }
  });

  it('handles zero filter limit and alternate fan target modes', () => {
    const state = createState();
    (state as any).setByName('filter_exchange_limit', 0);
    expect(state.getFilterStatus().remainingPercent).toBe(0);

    expect(state.setFanMode('away').ok).toBe(true);
    (state as any).awayDelayRemainingMinutes = 0;
    state.tick((state as any).lastTickMs);
    const awaySummary = state.summary();
    expect(awaySummary.mode).toBe('away');

    const cookerHood = pointByName('cooker_hood');
    expect(
      state.writePresentValue(cookerHood.type, cookerHood.instance, PROPERTY_ID.PRESENT_VALUE, 1, 13).ok,
    ).toBe(true);
    expect(state.summary().fan.supplyPercent).toBeGreaterThan(0);
  });

  it('relinquishes local cooker hood priority so the external source becomes effective again', () => {
    const state = createState();
    const cookerHood = pointByName('cooker_hood');

    expect((state as any).setSimulatedPoint('cooker_hood', 1).ok).toBe(true);

    const externallyActive = state.readPresentValue(cookerHood.type, cookerHood.instance, PROPERTY_ID.PRESENT_VALUE);
    if (!externallyActive.ok) throw new Error('Expected cooker hood point to be readable');
    expect(externallyActive.value.value).toBe(1);

    expect(
      state.writePresentValue(cookerHood.type, cookerHood.instance, PROPERTY_ID.PRESENT_VALUE, 0, 13).ok,
    ).toBe(true);
    const locallyOverridden = state.readPresentValue(cookerHood.type, cookerHood.instance, PROPERTY_ID.PRESENT_VALUE);
    if (!locallyOverridden.ok) throw new Error('Expected cooker hood point to be readable after override');
    expect(locallyOverridden.value.value).toBe(0);

    expect(
      state.writePresentValue(cookerHood.type, cookerHood.instance, PROPERTY_ID.PRESENT_VALUE, null, 13).ok,
    ).toBe(true);
    const relinquished = state.readPresentValue(cookerHood.type, cookerHood.instance, PROPERTY_ID.PRESENT_VALUE);
    if (!relinquished.ok) throw new Error('Expected cooker hood point to be readable after relinquish');
    expect(relinquished.value.value).toBe(1);
  });

  it('normalizes writable payloads and read tags across value types', () => {
    expect(valueToWriteNumber(12.5)).toBe(12.5);
    expect(valueToWriteNumber(true)).toBe(1);
    expect(valueToWriteNumber(false)).toBe(0);
    expect(valueToWriteNumber({ value: 9 })).toBe(9);
    expect(valueToWriteNumber({ value: 'bad' })).toBe(null);
    expect(valueToWriteNumber(null)).toBe(null);

    const boolPoint = pointByName('comfort_button');
    const realPoint = pointByName('temp_supply');

    expect(valueTagForRead(boolPoint)).toBe(APPLICATION_TAG.ENUMERATED);
    expect(valueTagForRead(realPoint)).toBe(APPLICATION_TAG.REAL);
    expect(valueTagForRead({
      ...realPoint,
      kind: 'unsigned',
    })).toBe(APPLICATION_TAG.UNSIGNED_INTEGER);
    expect(valueTagForRead({
      ...realPoint,
      kind: 'mystery',
    })).toBe(APPLICATION_TAG.REAL);
  });

  it('falls back to away mode when ventilation mode is neither high nor home', () => {
    const state = createState();
    (state as any).setByName('comfort_button', 1);
    (state as any).setByName('ventilation_mode', 0);
    (state as any).rapidRemainingMinutes = 0;
    (state as any).fireplaceRemainingMinutes = 0;
    state.tick((state as any).lastTickMs);
    expect(state.summary().mode).toBe('away');
  });

  it('counts down away-delay time only while away mode remains active', () => {
    const state = createState();
    expect(
      state.writePresentValue(OBJECT_TYPE.BINARY_VALUE, 50, PROPERTY_ID.PRESENT_VALUE, 0, 13).ok,
    ).toBe(true);
    const before = state.summary().timers.awayDelayMinutes;

    state.advanceSimulatedSeconds(60);
    const during = state.summary().timers.awayDelayMinutes;
    expect(during).toBeLessThan(before);

    expect(
      state.writePresentValue(OBJECT_TYPE.BINARY_VALUE, 50, PROPERTY_ID.PRESENT_VALUE, 1, 13).ok,
    ).toBe(true);
    state.advanceSimulatedSeconds(60);
    expect(state.summary().timers.awayDelayMinutes).toBe(0);
  });
});
