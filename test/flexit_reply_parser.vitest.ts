/* eslint-disable import/extensions */
import { describe, expect, it } from 'vitest';
import { parseFlexitReply } from '../lib/flexitReplyParser.ts';

describe('flexitReplyParser (vitest)', () => {
  it('uses model-based name when serial maps to a known model', () => {
    const payload = Buffer.from('HvacFnct21y_A 800131-000001 192.0.2.10:47808 FW1.2.3', 'ascii');
    const parsed = parseFlexitReply(payload, '192.0.2.1');
    expect(parsed).not.toBe(null);
    if (!parsed) return;
    expect(parsed.serialNormalized.startsWith('8001')).toBe(true);
    expect(parsed.ip).toBe('192.0.2.10');
    expect(parsed.bacnetPort).toBe(47808);
    expect(parsed.model).toBe('S4 REL');
    expect(parsed.name).toBe('Nordic S4 REL');
  });

  it('falls back to payload-friendly name when serial model is unknown', () => {
    const payload = Buffer.from('HvacFnct21y_A 800199-000001 192.0.2.10:47808 FW1.2.3', 'ascii');
    const parsed = parseFlexitReply(payload, '192.0.2.1');
    expect(parsed).not.toBe(null);
    if (!parsed) return;
    expect(parsed.model).toBe(undefined);
    expect(parsed.name).toBe('HvacFnct21y_A');
  });

  it('falls back to secondary friendly tokens and default endpoint values', () => {
    const payload = Buffer.from('NordicUnit 800199-000001 FW1.2.3', 'ascii');
    const parsed = parseFlexitReply(payload, '192.0.2.55');
    expect(parsed).not.toBe(null);
    if (!parsed) return;
    expect(parsed.model).toBe(undefined);
    expect(parsed.name).toBe('NordicUnit');
    expect(parsed.ip).toBe('192.0.2.55');
    expect(parsed.bacnetPort).toBe(47808);
    expect(parsed.fw).toBe('FW1.2.3');
  });

  it('falls back to a generic name when no friendly token is present', () => {
    const payload = Buffer.from('800199-000001 02:00:00:00:00:01', 'ascii');
    const parsed = parseFlexitReply(payload, '198.51.100.20');
    expect(parsed).not.toBe(null);
    if (!parsed) return;
    expect(parsed.name).toBe('Flexit Unit');
    expect(parsed.mac).toBe('02:00:00:00:00:01');
    expect(parsed.fw).toBe(undefined);
  });

  it('rejects non-Nordic serials', () => {
    const payload = Buffer.from('EcoNordic 900501-123456 198.51.100.23:47808 FW9.9.9', 'ascii');
    const parsed = parseFlexitReply(payload, '198.51.100.23');
    expect(parsed).toBe(null);
  });
});
