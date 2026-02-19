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
} = require('../scripts/fake-unit/manifest.ts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FakeNordicUnitState, valueTagForRead } = require('../scripts/fake-unit/state.ts');

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

describe('fake-unit state', () => {
  it('encodes MSV presentValue as unsigned integer', () => {
    const msvPoint = SUPPORTED_POINTS.find(
      (point) => point.type === OBJECT_TYPE.MULTI_STATE_VALUE && point.instance === 42,
    );
    expect(msvPoint).to.not.equal(undefined);
    expect(valueTagForRead(msvPoint!)).to.equal(APPLICATION_TAG.UNSIGNED_INTEGER);
  });

  it('keeps BV enum points encoded as enumerated', () => {
    const bvPoint = SUPPORTED_POINTS.find(
      (point) => point.type === OBJECT_TYPE.BINARY_VALUE && point.instance === 50,
    );
    expect(bvPoint).to.not.equal(undefined);
    expect(valueTagForRead(bvPoint!)).to.equal(APPLICATION_TAG.ENUMERATED);
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
});
