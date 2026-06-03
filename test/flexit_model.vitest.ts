/* eslint-disable import/extensions */
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  getNordicModelFromSerial,
  getEcoNordicModelFromSerial,
  getModelFromSerial,
  classifyFlexitSerial,
  serialMatchesDriverSeries,
} = require('../lib/flexitModel.ts');

describe('flexitModel (vitest)', () => {
  it('returns a known model for recognized serial prefixes', () => {
    expect(getNordicModelFromSerial('800131-123456')).toBe('S4 REL');
  });

  it('returns null for short or unknown serials', () => {
    expect(getNordicModelFromSerial('8001')).toBeNull();
    expect(getNordicModelFromSerial('899999-123456')).toBeNull();
  });

  it('classifies recognized Nordic serial prefixes as the nordic series', () => {
    expect(classifyFlexitSerial('800131-123456')).toBe('nordic');
    expect(classifyFlexitSerial('8003')).toBe(null); // too short to classify
    // A Nordic-prefixed serial with an unmapped model code is still nordic.
    expect(classifyFlexitSerial('800199-000001')).toBe('nordic');
  });

  it('does not classify unrecognized serials (EcoNordic prefixes not yet known)', () => {
    expect(classifyFlexitSerial('900501-123456')).toBe(null);
    expect(classifyFlexitSerial('not-a-serial')).toBe(null);
  });

  it('has no EcoNordic model codes until a real unit is captured', () => {
    expect(getEcoNordicModelFromSerial('900501-123456')).toBeNull();
  });

  it('resolves the model from a serial for an explicit series', () => {
    expect(getModelFromSerial('800131-123456', 'nordic')).toBe('S4 REL');
    expect(getModelFromSerial('800131-123456', 'econordic')).toBeNull();
  });

  it('adopts nordic and unrecognized serials for the nordic driver only', () => {
    expect(serialMatchesDriverSeries('800131-000001', 'nordic')).toBe(true);
    // Unrecognized serials are adopted by the nordic driver so nothing disappears.
    expect(serialMatchesDriverSeries('900501-000001', 'nordic')).toBe(true);
    expect(serialMatchesDriverSeries('800131-000001', 'econordic')).toBe(false);
    expect(serialMatchesDriverSeries('900501-000001', 'econordic')).toBe(false);
  });
});
