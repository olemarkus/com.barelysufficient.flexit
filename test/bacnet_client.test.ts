import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

const proxyquireStrict = proxyquire.noCallThru().noPreserveCache();

describe('bacnetClient', () => {
  afterEach(() => {
    sinon.restore();
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

    const bacnetClient = proxyquireStrict('../lib/bacnetClient', {
      bacstack: BacnetStub,
    });

    const defaultPortClient = bacnetClient.getBacnetClient(0);
    const repeatedDefaultPortClient = bacnetClient.getBacnetClient(Number.NaN);
    const customPortClient = bacnetClient.getBacnetClient(47809);

    expect(defaultPortClient).to.equal(firstClient);
    expect(repeatedDefaultPortClient).to.equal(firstClient);
    expect(customPortClient).to.equal(secondClient);
    expect(BacnetStub.firstCall.args[0]).to.deep.equal({
      port: 47808,
      apduTimeout: 10000,
      apduSize: 1476,
    });
    expect(BacnetStub.secondCall.args[0]).to.deep.equal({
      port: 47809,
      apduTimeout: 10000,
      apduSize: 1476,
    });
    expect(bacnetClient.BacnetEnums).to.equal(BacnetStub.enum);
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

    const bacnetClient = proxyquireStrict('../lib/bacnetClient', {
      bacstack: BacnetStub,
    });

    const logger = { error: sinon.stub() };
    bacnetClient.setBacnetLogger(logger);
    bacnetClient.getBacnetClient(47810);

    const failure = new Error('socket failed');
    errorHandler?.(failure);

    expect(logger.error.calledOnceWithExactly('[BacnetClient:47810] Error:', failure)).to.equal(true);
  });
});
