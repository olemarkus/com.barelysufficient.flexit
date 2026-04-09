import { describe, expect, it } from 'vitest';
import { UnitRegistry } from '../lib/UnitRegistry.ts';

describe('UnitRegistry legacy log normalization', () => {
  it('captures non-Error second arguments as the error payload for string messages', () => {
    const registry = new UnitRegistry();

    const normalized = (registry as any).normalizeLegacyLogArguments([
      '[UnitRegistry] Example failure:',
      { code: 'E_FAIL', retryable: true },
    ]);

    expect(normalized.msg).toBe('[UnitRegistry] Example failure:');
    expect(normalized.error).toEqual({ code: 'E_FAIL', retryable: true });
    expect(normalized.fields).toEqual({});
  });

  it('keeps the first argument as details when a non-string message is followed by an error payload', () => {
    const registry = new UnitRegistry();

    const normalized = (registry as any).normalizeLegacyLogArguments([
      { operation: 'cloudPoll' },
      'timed out',
    ]);

    expect(normalized.msg).toBe('Registry log emitted without a string message');
    expect(normalized.error).toBe('timed out');
    expect(normalized.fields).toEqual({
      details: { operation: 'cloudPoll' },
    });
  });
});
