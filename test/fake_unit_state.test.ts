/* eslint-disable import/extensions */
import { expect } from 'chai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  APPLICATION_TAG,
  DEFAULT_DEVICE_NAME,
  DEFAULT_FIRMWARE,
  DEFAULT_MODEL_NAME,
  DEFAULT_VENDOR_ID,
  DEFAULT_VENDOR_NAME,
  OBJECT_TYPE,
  PROPERTY_ID,
  SUPPORTED_POINTS,
  pointKey,
} = require('../scripts/fake-unit/manifest.ts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  FakeNordicUnitState,
  valueTagForRead,
  valueToWriteNumber,
} = require('../scripts/fake-unit/state.ts');

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
  expect(point).to.not.equal(undefined);
  return point!;
}

describe('fake-unit state', () => {
  it('encodes MSV presentValue as unsigned integer', () => {
    const msvPoint = SUPPORTED_POINTS.find(
      (point) => point.type === OBJECT_TYPE.MULTI_STATE_VALUE && point.instance === 42,
    );
    expect(msvPoint).to.not.equal(undefined);
    expect(valueTagForRead(msvPoint!)).to.equal(APPLICATION_TAG.UNSIGNED_INTEGER);
  });

  it('keeps BV enum points encoded as enumerated', () => {
    const comfortBvPoint = SUPPORTED_POINTS.find(
      (point) => point.type === OBJECT_TYPE.BINARY_VALUE && point.instance === 50,
    );
    const heatingCoilBvPoint = SUPPORTED_POINTS.find(
      (point) => point.type === OBJECT_TYPE.BINARY_VALUE && point.instance === 445,
    );
    expect(comfortBvPoint).to.not.equal(undefined);
    expect(heatingCoilBvPoint).to.not.equal(undefined);
    expect(valueTagForRead(comfortBvPoint!)).to.equal(APPLICATION_TAG.ENUMERATED);
    expect(valueTagForRead(heatingCoilBvPoint!)).to.equal(APPLICATION_TAG.ENUMERATED);
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
    expect(priority13Write.ok).to.equal(true);

    const priority16Write = state.writePresentValue(
      OBJECT_TYPE.BINARY_VALUE,
      445,
      PROPERTY_ID.PRESENT_VALUE,
      1,
      16,
    );
    expect(priority16Write.ok).to.equal(true);

    const denied = state.writePresentValue(
      OBJECT_TYPE.BINARY_VALUE,
      445,
      PROPERTY_ID.PRESENT_VALUE,
      0,
      12,
    );
    expect(denied.ok).to.equal(false);
  });

  it('accepts missing priority and GO compatibility priority while rejecting invalid explicit priorities', () => {
    const state = createState();
    const missingPriorityAllowed = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      1994,
      PROPERTY_ID.PRESENT_VALUE,
      21,
    );
    expect(missingPriorityAllowed.ok).to.equal(true);

    const goPriorityAllowed = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      1994,
      PROPERTY_ID.PRESENT_VALUE,
      21,
      16,
    );
    expect(goPriorityAllowed.ok).to.equal(true);

    const denied = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      1994,
      PROPERTY_ID.PRESENT_VALUE,
      21,
      12,
    );
    expect(denied.ok).to.equal(false);

    const allowed = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      1994,
      PROPERTY_ID.PRESENT_VALUE,
      21,
      13,
    );
    expect(allowed.ok).to.equal(true);
  });

  it('supports mode switching and summary rendering', () => {
    const state = createState();
    const result = state.setFanMode('high');
    expect(result.ok).to.equal(true);

    const summary = state.summary();
    expect(summary.mode).to.equal('high');
    expect(summary.fan.supplyPercent).to.be.greaterThan(90);
  });

  it('supports filter maintenance operations', () => {
    const state = createState();
    expect(state.setFilterLimitHours(5000).ok).to.equal(true);
    expect(state.setFilterOperatingHours(1000).ok).to.equal(true);

    const before = state.getFilterStatus();
    expect(before.limitHours).to.equal(5000);
    expect(before.operatingHours).to.equal(1000);

    expect(state.replaceFilter().ok).to.equal(true);
    const after = state.getFilterStatus();
    expect(after.operatingHours).to.equal(0);
  });

  it('resets filter operating time through filter reset trigger points', () => {
    const state = createState();
    expect(state.setFilterOperatingHours(1000).ok).to.equal(true);

    const primaryReset = state.writePresentValue(
      OBJECT_TYPE.MULTI_STATE_VALUE,
      613,
      PROPERTY_ID.PRESENT_VALUE,
      2,
      13,
    );
    expect(primaryReset.ok).to.equal(true);
    expect(state.getFilterStatus().operatingHours).to.equal(0);

    expect(state.setFilterOperatingHours(500).ok).to.equal(true);
    const legacyReset = state.writePresentValue(
      OBJECT_TYPE.MULTI_STATE_VALUE,
      609,
      PROPERTY_ID.PRESENT_VALUE,
      2,
      13,
    );
    expect(legacyReset.ok).to.equal(true);
    expect(state.getFilterStatus().operatingHours).to.equal(0);
  });

  it('accepts observed Flexit GO compatibility reset write for AV:285', () => {
    const state = createState();
    expect(state.setFilterOperatingHours(220).ok).to.equal(true);

    const goResetWrite = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      285,
      PROPERTY_ID.PRESENT_VALUE,
      0,
      16,
    );
    expect(goResetWrite.ok).to.equal(true);
    expect(state.getFilterStatus().operatingHours).to.equal(0);

    const nonZeroDenied = state.writePresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      285,
      PROPERTY_ID.PRESENT_VALUE,
      50,
      16,
    );
    expect(nonZeroDenied.ok).to.equal(false);
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

    expect(writeHomeSupply.ok).to.equal(true);
    expect(writeHomeExhaust.ok).to.equal(true);
    state.setFanMode('home');
    const summary = state.summary();
    expect(summary.fan.supplyPercent).to.equal(70);
    expect(summary.fan.extractPercent).to.equal(60);
  });

  it('reports read errors for unsupported properties, objects, and missing values', () => {
    const state = createState();

    const unsupportedProperty = state.readPresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      1994,
      PROPERTY_ID.MIN_PRESENT_VALUE,
    );
    expect(unsupportedProperty.ok).to.equal(false);

    const unknownObject = state.readPresentValue(
      OBJECT_TYPE.ANALOG_VALUE,
      999999,
      PROPERTY_ID.PRESENT_VALUE,
    );
    expect(unknownObject.ok).to.equal(false);

    const setpointHome = pointByName('setpoint_home');
    (state as any).values.delete(pointKey(setpointHome.type, setpointHome.instance));
    const missingValue = state.readPresentValue(
      setpointHome.type,
      setpointHome.instance,
      PROPERTY_ID.PRESENT_VALUE,
    );
    expect(missingValue.ok).to.equal(false);
  });

  it('rejects invalid writes for type, property, object, access, and range', () => {
    const state = createState();

    expect(
      state.writePresentValue(OBJECT_TYPE.ANALOG_VALUE, 1994, PROPERTY_ID.PRESENT_VALUE, Number.NaN).ok,
    ).to.equal(false);
    expect(
      state.writePresentValue(OBJECT_TYPE.ANALOG_VALUE, 1994, PROPERTY_ID.MIN_PRESENT_VALUE, 20).ok,
    ).to.equal(false);
    expect(
      state.writePresentValue(OBJECT_TYPE.ANALOG_VALUE, 999999, PROPERTY_ID.PRESENT_VALUE, 20).ok,
    ).to.equal(false);
    expect(
      state.writePresentValue(OBJECT_TYPE.ANALOG_INPUT, 4, PROPERTY_ID.PRESENT_VALUE, 20, 13).ok,
    ).to.equal(false);
    expect(
      state.writePresentValue(OBJECT_TYPE.ANALOG_VALUE, 1994, PROPERTY_ID.PRESENT_VALUE, 200, 13).ok,
    ).to.equal(false);
  });

  it('covers missing-object and first-write failure paths for fan mode changes', () => {
    const missingAwayState = createState();
    (missingAwayState as any).pointsByName.delete('comfort_button');
    expect(missingAwayState.setFanMode('away').ok).to.equal(false);

    const missingHomeState = createState();
    (missingHomeState as any).pointsByName.delete('ventilation_mode');
    expect(missingHomeState.setFanMode('home').ok).to.equal(false);
    expect(missingHomeState.setFanMode('high').ok).to.equal(false);

    const missingFireplaceState = createState();
    (missingFireplaceState as any).pointsByName.delete('trigger_fireplace');
    expect(missingFireplaceState.setFanMode('fireplace').ok).to.equal(false);

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

    expect(failingWriteState.setFanMode('home').ok).to.equal(false);
    expect(failingWriteState.setFanMode('high').ok).to.equal(false);
    expect(failingWriteState.setFanMode('invalid' as any).ok).to.equal(false);
  });

  it('fails setpoint writes when the underlying points are missing', () => {
    const state = createState();
    (state as any).pointsByName.delete('setpoint_home');
    (state as any).pointsByName.delete('setpoint_away');
    expect(state.setHomeSetpoint(20).ok).to.equal(false);
    expect(state.setAwaySetpoint(18).ok).to.equal(false);
  });

  it('starts rapid and fireplace timers with default and explicit runtime handling', () => {
    const state = createState();

    expect(state.startRapid().ok).to.equal(true);
    expect(state.summary().timers.rapidMinutes).to.be.greaterThan(0);

    expect(state.startFireplace().ok).to.equal(true);
    expect(state.summary().timers.fireplaceMinutes).to.be.greaterThan(0);

    expect(state.startRapid(9999).ok).to.equal(false);
    expect(state.startFireplace(9999).ok).to.equal(false);
    expect(state.advanceSimulatedSeconds(0)).to.equal(undefined);
  });

  it('tracks away delay, trigger writes, and direct runtime writes', () => {
    const state = createState();
    const rapidRuntime = pointByName('runtime_rapid');
    const rapidTrigger = pointByName('trigger_rapid');
    const fireplaceRuntime = pointByName('runtime_fireplace');
    const fireplaceTrigger = pointByName('trigger_fireplace');

    expect(
      state.writePresentValue(OBJECT_TYPE.BINARY_VALUE, 50, PROPERTY_ID.PRESENT_VALUE, 0, 13).ok,
    ).to.equal(true);
    expect(state.summary().timers.awayDelayMinutes).to.be.greaterThan(0);

    expect(
      state.writePresentValue(OBJECT_TYPE.BINARY_VALUE, 50, PROPERTY_ID.PRESENT_VALUE, 1, 13).ok,
    ).to.equal(true);
    expect(state.summary().timers.awayDelayMinutes).to.equal(0);

    expect(
      state.writePresentValue(
        rapidRuntime.type,
        rapidRuntime.instance,
        PROPERTY_ID.PRESENT_VALUE,
        12,
        13,
      ).ok,
    ).to.equal(true);
    expect(
      state.writePresentValue(
        rapidTrigger.type,
        rapidTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        13,
      ).ok,
    ).to.equal(true);
    expect(state.summary().timers.rapidMinutes).to.be.greaterThan(0);

    expect(
      state.writePresentValue(
        fireplaceRuntime.type,
        fireplaceRuntime.instance,
        PROPERTY_ID.PRESENT_VALUE,
        18,
        13,
      ).ok,
    ).to.equal(true);
    expect(
      state.writePresentValue(
        fireplaceTrigger.type,
        fireplaceTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        13,
      ).ok,
    ).to.equal(true);
    expect(state.summary().timers.fireplaceMinutes).to.be.greaterThan(0);
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
    ).to.equal(true);
    expect(
      state.writePresentValue(
        fireplaceTrigger.type,
        fireplaceTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        13,
      ).ok,
    ).to.equal(true);

    const activeSummary = state.summary();
    expect(activeSummary.mode).to.equal('fireplace');
    expect(activeSummary.timers.fireplaceMinutes).to.be.closeTo(18, 0.1);

    state.advanceSimulatedSeconds(60);
    const activeRemaining = state.summary().timers.fireplaceMinutes;
    expect(activeRemaining).to.be.lessThan(17.5);

    expect(
      state.writePresentValue(
        fireplaceTrigger.type,
        fireplaceTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        13,
      ).ok,
    ).to.equal(true);

    const inactiveSummary = state.summary();
    expect(inactiveSummary.mode).to.equal('home');
    expect(inactiveSummary.timers.fireplaceMinutes).to.be.closeTo(18, 0.1);

    const fireplaceActive = state.readPresentValue(OBJECT_TYPE.BINARY_VALUE, 400, PROPERTY_ID.PRESENT_VALUE);
    const operationMode = state.readPresentValue(OBJECT_TYPE.MULTI_STATE_VALUE, 361, PROPERTY_ID.PRESENT_VALUE);
    if (!fireplaceActive.ok || !operationMode.ok) {
      throw new Error('Expected fireplace active and operation mode points to be readable');
    }
    expect(fireplaceActive.value.value).to.equal(0);
    expect(operationMode.value.value).to.equal(3);

    state.advanceSimulatedSeconds(60);
    expect(state.summary().timers.fireplaceMinutes).to.be.closeTo(inactiveSummary.timers.fireplaceMinutes, 0.05);

    expect(
      state.writePresentValue(
        fireplaceTrigger.type,
        fireplaceTrigger.instance,
        PROPERTY_ID.PRESENT_VALUE,
        2,
        13,
      ).ok,
    ).to.equal(true);
    expect(state.summary().mode).to.equal('fireplace');
  });

  it('handles zero filter limit and alternate fan target modes', () => {
    const state = createState();
    (state as any).setByName('filter_exchange_limit', 0);
    expect(state.getFilterStatus().remainingPercent).to.equal(0);

    expect(state.setFanMode('away').ok).to.equal(true);
    (state as any).awayDelayRemainingMinutes = 0;
    state.tick((state as any).lastTickMs);
    const awaySummary = state.summary();
    expect(awaySummary.mode).to.equal('away');

    const cookerHood = pointByName('cooker_hood');
    expect(
      state.writePresentValue(cookerHood.type, cookerHood.instance, PROPERTY_ID.PRESENT_VALUE, 1, 13).ok,
    ).to.equal(true);
    expect(state.summary().fan.supplyPercent).to.be.greaterThan(0);
  });

  it('normalizes writable payloads and read tags across value types', () => {
    expect(valueToWriteNumber(12.5)).to.equal(12.5);
    expect(valueToWriteNumber(true)).to.equal(1);
    expect(valueToWriteNumber(false)).to.equal(0);
    expect(valueToWriteNumber({ value: 9 })).to.equal(9);
    expect(valueToWriteNumber({ value: 'bad' })).to.equal(null);
    expect(valueToWriteNumber(null)).to.equal(null);

    const boolPoint = pointByName('comfort_button');
    const realPoint = pointByName('temp_supply');

    expect(valueTagForRead(boolPoint)).to.equal(APPLICATION_TAG.ENUMERATED);
    expect(valueTagForRead(realPoint)).to.equal(APPLICATION_TAG.REAL);
    expect(valueTagForRead({
      ...realPoint,
      kind: 'unsigned',
    })).to.equal(APPLICATION_TAG.UNSIGNED_INTEGER);
    expect(valueTagForRead({
      ...realPoint,
      kind: 'mystery',
    })).to.equal(APPLICATION_TAG.REAL);
  });

  it('falls back to away mode when ventilation mode is neither high nor home', () => {
    const state = createState();
    (state as any).setByName('comfort_button', 1);
    (state as any).setByName('ventilation_mode', 0);
    (state as any).rapidRemainingMinutes = 0;
    (state as any).fireplaceRemainingMinutes = 0;
    state.tick((state as any).lastTickMs);
    expect(state.summary().mode).to.equal('away');
  });

  it('counts down away-delay time only while away mode remains active', () => {
    const state = createState();
    expect(
      state.writePresentValue(OBJECT_TYPE.BINARY_VALUE, 50, PROPERTY_ID.PRESENT_VALUE, 0, 13).ok,
    ).to.equal(true);
    const before = state.summary().timers.awayDelayMinutes;

    state.advanceSimulatedSeconds(60);
    const during = state.summary().timers.awayDelayMinutes;
    expect(during).to.be.lessThan(before);

    expect(
      state.writePresentValue(OBJECT_TYPE.BINARY_VALUE, 50, PROPERTY_ID.PRESENT_VALUE, 1, 13).ok,
    ).to.equal(true);
    state.advanceSimulatedSeconds(60);
    expect(state.summary().timers.awayDelayMinutes).to.equal(0);
  });
});
