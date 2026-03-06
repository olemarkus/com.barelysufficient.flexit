/* eslint-disable import/extensions */
import { expect } from 'chai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getNordicModelFromSerial } = require('../lib/flexitModel.ts');

describe('flexitModel', () => {
  it('returns a known model for recognized serial prefixes', () => {
    expect(getNordicModelFromSerial('800131-123456')).to.equal('S4 REL');
  });

  it('returns null for short or unknown serials', () => {
    expect(getNordicModelFromSerial('8001')).to.equal(null);
    expect(getNordicModelFromSerial('899999-123456')).to.equal(null);
  });
});
