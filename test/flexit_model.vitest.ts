/* eslint-disable import/extensions */
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getNordicModelFromSerial } = require('../lib/flexitModel.ts');

describe('flexitModel (vitest)', () => {
  it('returns a known model for recognized serial prefixes', () => {
    expect(getNordicModelFromSerial('800131-123456')).toBe('S4 REL');
  });

  it('returns null for short or unknown serials', () => {
    expect(getNordicModelFromSerial('8001')).toBeNull();
    expect(getNordicModelFromSerial('899999-123456')).toBeNull();
  });
});
