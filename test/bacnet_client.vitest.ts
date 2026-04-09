import sinon from 'sinon';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BacnetEnums,
  getBacnetClient,
  resetBacnetClientStateForTests,
  setBacnetLogger,
  setBacnetModuleForTests,
} from '../lib/bacnetClient.ts';
import { createRuntimeLogger } from '../lib/logging';
import { findStructuredLog } from './logging_test_utils';

describe('bacnetClient (vitest)', () => {
  afterEach(() => {
    sinon.restore();
    resetBacnetClientStateForTests();
  });

  it('reuses clients per port and falls back to the default BACnet port', () => {
    const firstClient = { on: sinon.stub() };
    const secondClient = { on: sinon.stub() };
    const BacnetStub: any = sinon.stub();
    BacnetStub
      .onFirstCall()
      .returns(firstClient)
      .onSecondCall()
      .returns(secondClient);
    BacnetStub.enum = { ApplicationTags: { REAL: 4 } };

    setBacnetModuleForTests(BacnetStub);

    const defaultPortClient = getBacnetClient(0);
    const repeatedDefaultPortClient = getBacnetClient(Number.NaN);
    const customPortClient = getBacnetClient(47809);

    expect(defaultPortClient).toBe(firstClient);
    expect(repeatedDefaultPortClient).toBe(firstClient);
    expect(customPortClient).toBe(secondClient);
    expect(BacnetStub.firstCall.args[0]).toEqual({
      port: 47808,
      apduTimeout: 15000,
      apduSize: 1476,
    });
    expect(BacnetStub.secondCall.args[0]).toEqual({
      port: 47809,
      apduTimeout: 15000,
      apduSize: 1476,
    });
    expect(BacnetEnums.ApplicationTags).toBe(BacnetStub.enum.ApplicationTags);
  });

  it('logs BACnet client error events through the configured logger', () => {
    let errorHandler: ((error: Error) => void) | undefined;
    const client = {
      on: sinon.stub().callsFake((event: string, handler: (error: Error) => void) => {
        if (event === 'error') {
          errorHandler = handler;
        }
      }),
    };
    const BacnetStub: any = sinon.stub().returns(client);
    BacnetStub.enum = {};

    setBacnetModuleForTests(BacnetStub);

    const sink = { log: sinon.stub(), error: sinon.stub() };
    setBacnetLogger(createRuntimeLogger(sink, { component: 'registry' }));
    getBacnetClient(47810);

    const failure = new Error('socket failed');
    errorHandler?.(failure);

    const log = findStructuredLog(sink.error, 'bacnet.client.error');
    expect(log?.port).toBe(47810);
    expect(log?.error?.message).toBe('socket failed');
  });
});
