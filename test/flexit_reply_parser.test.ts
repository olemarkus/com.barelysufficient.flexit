import { expect } from 'chai';
import { parseFlexitReply } from '../lib/flexitReplyParser';

describe('flexitReplyParser', () => {
  it('uses model-based name when serial maps to a known model', () => {
    const payload = Buffer.from('HvacFnct21y_A 800131-000001 192.0.2.10:47808 FW1.2.3', 'ascii');
    const parsed = parseFlexitReply(payload, '192.0.2.1');
    expect(parsed).to.not.equal(null);
    if (!parsed) return;
    expect(parsed.serialNormalized.startsWith('8001')).to.equal(true);
    expect(parsed.ip).to.equal('192.0.2.10');
    expect(parsed.bacnetPort).to.equal(47808);
    expect(parsed.model).to.equal('S4 REL');
    expect(parsed.name).to.equal('Nordic S4 REL');
  });

  it('falls back to payload-friendly name when serial model is unknown', () => {
    const payload = Buffer.from('HvacFnct21y_A 800199-000001 192.0.2.10:47808 FW1.2.3', 'ascii');
    const parsed = parseFlexitReply(payload, '192.0.2.1');
    expect(parsed).to.not.equal(null);
    if (!parsed) return;
    expect(parsed.model).to.equal(undefined);
    expect(parsed.name).to.equal('HvacFnct21y_A');
  });

  it('rejects non-Nordic serials', () => {
    const payload = Buffer.from('EcoNordic 900501-123456 198.51.100.23:47808 FW9.9.9', 'ascii');
    const parsed = parseFlexitReply(payload, '198.51.100.23');
    expect(parsed).to.equal(null);
  });
});
