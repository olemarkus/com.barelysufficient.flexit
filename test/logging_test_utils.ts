import sinon from 'sinon';

export function parseStructuredLogArg(arg: unknown) {
  if (typeof arg !== 'string') {
    throw new Error(`Expected structured log line string, got ${typeof arg}`);
  }
  return JSON.parse(arg) as Record<string, any>;
}

export function getStructuredLogs(stub: sinon.SinonStub) {
  return stub.getCalls().map((call) => parseStructuredLogArg(call.args[0]));
}

export function findStructuredLog(stub: sinon.SinonStub, event: string) {
  return getStructuredLogs(stub).find((entry) => entry.event === event);
}
