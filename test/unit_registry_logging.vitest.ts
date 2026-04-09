import sinon from 'sinon';
import { describe, expect, it } from 'vitest';
import { UnitRegistry } from '../lib/UnitRegistry.ts';
import { parseStructuredLogArg } from './logging_test_utils';

describe('UnitRegistry legacy log normalization', () => {
  it('treats object second arguments as details for info logs', () => {
    const registry = new UnitRegistry();

    const normalized = (registry as any).normalizeLegacyLogArguments([
      '[UnitRegistry] Example failure:',
      { code: 'E_FAIL', retryable: true },
    ], 'info');

    expect(normalized.msg).toBe('[UnitRegistry] Example failure:');
    expect(normalized.error).toBeUndefined();
    expect(normalized.fields).toEqual({
      details: { code: 'E_FAIL', retryable: true },
    });
  });

  it('keeps the first argument as details when a non-string message is followed by an error payload', () => {
    const registry = new UnitRegistry();

    const normalized = (registry as any).normalizeLegacyLogArguments([
      { operation: 'cloudPoll' },
      'timed out',
    ], 'error');

    expect(normalized.msg).toBe('Registry log emitted without a string message');
    expect(normalized.error).toBe('timed out');
    expect(normalized.fields).toEqual({
      details: { operation: 'cloudPoll' },
    });
  });

  it('routes fallback device logs through the runtime logger formatting path', () => {
    const registry = new UnitRegistry();
    const device = {
      getData: () => ({ unitId: 'unit-1' }),
      getSetting: () => null,
      setCapabilityValue: async () => {},
      setAvailable: async () => {},
      setUnavailable: async () => {},
      log: sinon.stub(),
      error: sinon.stub(),
    };

    (registry as any).units.set('unit-1', {
      unitId: 'unit-1',
      serial: 'serial-1',
      transport: 'bacnet',
      unsupportedCloudPollPaths: new Set(),
      devices: new Set([device]),
      pollInterval: null,
      rediscoverInterval: null,
      pollInFlight: false,
      pollGeneration: 0,
      ip: '127.0.0.1',
      bacnetPort: 47808,
      writeQueue: Promise.resolve(),
      probeValues: new Map(),
      blockedWrites: new Set(),
      pendingWriteErrors: new Map(),
      lastWriteValues: new Map(),
      lastPollAt: undefined,
      writeContext: new Map(),
      consecutiveFailures: 0,
      available: true,
    });

    (registry as any).log('[UnitRegistry] Example info', { source: 'fallback' });
    (registry as any).error('[UnitRegistry] Example error', new Error('boom'));

    const infoRecord = parseStructuredLogArg(device.log.firstCall.args[0]);
    const errorRecord = parseStructuredLogArg(device.error.firstCall.args[0]);
    expect(infoRecord.event).toBe('registry.legacy.info');
    expect(infoRecord.details).toEqual({ source: 'fallback' });
    expect(errorRecord.event).toBe('registry.legacy.error');
    expect(errorRecord.error.message).toBe('boom');
  });
});
