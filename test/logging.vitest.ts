import sinon from 'sinon';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRuntimeLogger,
  getLogContext,
  getLogLevelForTests,
  runWithLogContext,
} from '../lib/logging';
import { parseStructuredLogArg } from './logging_test_utils';

describe('logging', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('routes info logs to the info sink and applies child bindings', () => {
    const sink = { log: sinon.stub(), error: sinon.stub() };
    const logger = createRuntimeLogger(sink, { component: 'app' }).child({ unitId: 'unit-1' });

    logger.info('app.init', 'App initialized', { appVersion: '1.0.0' });

    const record = parseStructuredLogArg(sink.log.firstCall.args[0]);
    expect(record.component).toBe('app');
    expect(record.unitId).toBe('unit-1');
    expect(record.event).toBe('app.init');
    expect(record.msg).toBe('App initialized');
    expect(record.appVersion).toBe('1.0.0');
    expect(record.level).toBeUndefined();
    expect(record.time).toBeUndefined();
    expect(sink.error.called).toBe(false);
  });

  it('routes error logs to the error sink and serializes Error metadata', () => {
    const sink = { log: sinon.stub(), error: sinon.stub() };
    const logger = createRuntimeLogger(sink);
    const error = new Error('boom') as Error & { code?: string; status?: number };
    error.code = 'ERR_FAIL';
    error.status = 503;

    logger.error('app.failed', 'App failed', error, { operation: 'startup' });

    const record = parseStructuredLogArg(sink.error.firstCall.args[0]);
    expect(record.event).toBe('app.failed');
    expect(record.operation).toBe('startup');
    expect(record.error.message).toBe('boom');
    expect(record.error.code).toBe('ERR_FAIL');
    expect(record.error.status).toBe(503);
    expect(record.level).toBeUndefined();
    expect(record.time).toBeUndefined();
  });

  it('serializes primitive and object-like error values', () => {
    const sink = { log: sinon.stub(), error: sinon.stub() };
    const logger = createRuntimeLogger(sink);

    logger.error('primitive.error', 'Primitive error', 'nope');
    logger.error('object.error', 'Object error', { retryable: true });

    const primitiveRecord = parseStructuredLogArg(sink.error.firstCall.args[0]);
    const objectRecord = parseStructuredLogArg(sink.error.secondCall.args[0]);
    expect(primitiveRecord.error.message).toBe('nope');
    expect(objectRecord.error.details).toEqual({ retryable: true });
  });

  it('redacts sensitive fields', () => {
    const sink = { log: sinon.stub(), error: sinon.stub() };
    const logger = createRuntimeLogger(sink);

    logger.info('auth.test', 'Auth log', {
      password: 'secret',
      accessToken: 'token',
      refreshToken: 'refresh',
      headers: {
        Authorization: 'Bearer token',
      },
    });

    const record = parseStructuredLogArg(sink.log.firstCall.args[0]);
    expect(record.password).toBe('[Redacted]');
    expect(record.accessToken).toBe('[Redacted]');
    expect(record.refreshToken).toBe('[Redacted]');
    expect(record.headers.Authorization).toBe('[Redacted]');
  });

  it('propagates async log context and exposes the current context', async () => {
    const sink = { log: sinon.stub(), error: sinon.stub() };
    const logger = createRuntimeLogger(sink);

    expect(getLogContext()).toEqual({});

    await runWithLogContext({ operationId: 'op-1' }, async () => {
      expect(getLogContext()).toEqual({ operationId: 'op-1' });
      await runWithLogContext({ unitId: 'unit-1' }, async () => {
        logger.info('context.test', 'Context test');
      });
    });

    const record = parseStructuredLogArg(sink.log.firstCall.args[0]);
    expect(record.operationId).toBe('op-1');
    expect(record.unitId).toBe('unit-1');
  });

  it('falls back to info level for malformed or untyped log lines', () => {
    expect(getLogLevelForTests('not-json')).toBe(30);
    expect(getLogLevelForTests(JSON.stringify({ message: 'missing level' }))).toBe(30);
    expect(getLogLevelForTests(JSON.stringify({ level: 50 }))).toBe(50);
    expect(getLogLevelForTests(JSON.stringify({ level: 'fatal' }))).toBe(60);
  });
});
