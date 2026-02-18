/* eslint-disable import/extensions */
import { expect } from 'chai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  APPLICATION_TAG,
  FLEXIT_GO_RANGE_MAX_PROPERTY_ID,
  FLEXIT_GO_RANGE_MIN_PROPERTY_ID,
  FLEXIT_GO_PRIORITY_HINT_PROPERTY_ID,
  FLEXIT_GO_PRIORITY_HINT_VALUE,
  FLEXIT_GO_PROPRIETARY_COMPAT,
  OBJECT_TYPE,
  PROPERTY_ID,
  SUPPORTED_POINTS,
} = require('../scripts/fake-unit/manifest.ts');

function findCompatObject(type: number, instance: number) {
  return FLEXIT_GO_PROPRIETARY_COMPAT.objects.find((obj) => obj.objectType === type && obj.instance === instance);
}

describe('fake-unit manifest', () => {
  it('keeps proprietary compatibility objects out of documented supported points', () => {
    const proprietaryAvs = [
      8,
      60,
      126,
      130,
      1831,
      1833,
      1834,
      1835,
      1836,
      1837,
      1838,
      1839,
      1840,
      1841,
      1842,
      1843,
      1844,
      1919,
      2090,
      2096,
      2113,
      2114,
      2115,
      2118,
      2119,
      2120,
      2121,
      2122,
      2275,
    ];
    for (const instance of proprietaryAvs) {
      const existsInDocumented = SUPPORTED_POINTS.some((point) => (
        point.type === OBJECT_TYPE.ANALOG_VALUE && point.instance === instance
      ));
      expect(existsInDocumented, `AV ${instance} should not be in documented points`).to.equal(false);
    }
  });

  it('contains probed AV 1835..1844 present/min/max compatibility values', () => {
    const expected = [
      {
        instance: 1835, present: 100, max: 100, min: 80,
      },
      {
        instance: 1836, present: 80, max: 100, min: 56,
      },
      {
        instance: 1837, present: 56, max: 80, min: 30,
      },
      {
        instance: 1838, present: 90, max: 100, min: 30,
      },
      {
        instance: 1839, present: 90, max: 100, min: 30,
      },
      {
        instance: 1840, present: 99, max: 100, min: 79,
      },
      {
        instance: 1841, present: 79, max: 99, min: 55,
      },
      {
        instance: 1842, present: 55, max: 79, min: 30,
      },
      {
        instance: 1843, present: 50, max: 100, min: 30,
      },
      {
        instance: 1844, present: 50, max: 100, min: 30,
      },
    ];

    for (const entry of expected) {
      const point = findCompatObject(OBJECT_TYPE.ANALOG_VALUE, entry.instance);
      const present = point?.properties.find((property) => property.id === PROPERTY_ID.PRESENT_VALUE);
      const maxHint = point?.properties.find((property) => property.id === FLEXIT_GO_RANGE_MAX_PROPERTY_ID);
      const minHint = point?.properties.find((property) => property.id === FLEXIT_GO_RANGE_MIN_PROPERTY_ID);

      expect(present).to.include({
        tag: APPLICATION_TAG.REAL,
        value: entry.present,
      });
      expect(maxHint).to.include({
        tag: APPLICATION_TAG.REAL,
        value: entry.max,
      });
      expect(minHint).to.include({
        tag: APPLICATION_TAG.REAL,
        value: entry.min,
      });
    }
  });

  it('contains probed proprietary AV compatibility values', () => {
    const av60 = findCompatObject(OBJECT_TYPE.ANALOG_VALUE, 60);
    const av1831 = findCompatObject(OBJECT_TYPE.ANALOG_VALUE, 1831);
    const av1833 = findCompatObject(OBJECT_TYPE.ANALOG_VALUE, 1833);
    const av1834 = findCompatObject(OBJECT_TYPE.ANALOG_VALUE, 1834);
    const av2090 = findCompatObject(OBJECT_TYPE.ANALOG_VALUE, 2090);
    const av2096 = findCompatObject(OBJECT_TYPE.ANALOG_VALUE, 2096);

    expect(av60?.properties[0]).to.include({
      id: PROPERTY_ID.PRESENT_VALUE,
      tag: APPLICATION_TAG.REAL,
      value: 70,
    });
    expect(av1831?.properties[0]).to.include({
      id: PROPERTY_ID.PRESENT_VALUE,
      tag: APPLICATION_TAG.REAL,
      value: 700,
    });
    expect(av1833?.properties[0]).to.include({
      id: PROPERTY_ID.PRESENT_VALUE,
      tag: APPLICATION_TAG.REAL,
      value: 700,
    });
    expect(av1834?.properties[0]).to.include({
      id: PROPERTY_ID.PRESENT_VALUE,
      tag: APPLICATION_TAG.REAL,
      value: 700,
    });
    expect(av2090?.properties[0]).to.include({
      id: PROPERTY_ID.PRESENT_VALUE,
      tag: APPLICATION_TAG.REAL,
      value: 22.999996185302734,
    });
    expect(av2096?.properties[0]).to.include({
      id: PROPERTY_ID.PRESENT_VALUE,
      tag: APPLICATION_TAG.REAL,
      value: 0,
    });
  });

  it('contains proprietary 5093 overlays for msv42 and bv50', () => {
    const overlays = FLEXIT_GO_PROPRIETARY_COMPAT.propertyOverlays;
    const msv42 = overlays.find((overlay) => overlay.objectType === OBJECT_TYPE.MULTI_STATE_VALUE && overlay.instance === 42);
    const bv50 = overlays.find((overlay) => overlay.objectType === OBJECT_TYPE.BINARY_VALUE && overlay.instance === 50);

    expect(msv42?.properties[0]).to.include({
      id: FLEXIT_GO_PRIORITY_HINT_PROPERTY_ID,
      tag: APPLICATION_TAG.UNSIGNED_INTEGER,
      value: FLEXIT_GO_PRIORITY_HINT_VALUE,
    });
    expect(bv50?.properties[0]).to.include({
      id: FLEXIT_GO_PRIORITY_HINT_PROPERTY_ID,
      tag: APPLICATION_TAG.UNSIGNED_INTEGER,
      value: FLEXIT_GO_PRIORITY_HINT_VALUE,
    });
  });
});
