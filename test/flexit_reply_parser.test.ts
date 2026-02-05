import { expect } from 'chai';
import { parseFlexitReply } from '../lib/flexitReplyParser';

describe('flexitReplyParser', () => {
  it('parses Nordic serials', () => {
    const payload = Buffer.from('HvacFnct21y_A 800131-008843 192.168.88.32:47808 FW1.2.3', 'ascii');
    const parsed = parseFlexitReply(payload, '192.168.88.1');
    expect(parsed).to.not.equal(null);
    if (!parsed) return;
    expect(parsed.serialNormalized.startsWith('8001')).to.equal(true);
    expect(parsed.ip).to.equal('192.168.88.32');
    expect(parsed.bacnetPort).to.equal(47808);
  });

  it('rejects non-Nordic serials', () => {
    const payload = Buffer.from('EcoNordic 800501-123456 192.168.88.33:47808 FW9.9.9', 'ascii');
    const parsed = parseFlexitReply(payload, '192.168.88.33');
    expect(parsed).to.equal(null);
  });
});
