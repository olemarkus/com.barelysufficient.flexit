/**
 * Shared bacstack client(s) per local UDP port, to avoid multiple instances
 * binding the same port when you have multiple devices.
 */
import Bacnet from 'bacstack';

type BacnetClient = any;
type BacnetLogger = {
  error(...args: any[]): void;
};
type BacnetModule = {
  new (options: {
    port: number;
    apduTimeout: number;
    apduSize: number;
  }): BacnetClient;
  enum: Record<string, any>;
};

const clientsByPort = new Map<number, BacnetClient>();
let bacnetLogger: BacnetLogger | undefined;
const defaultBacnetModule = Bacnet as unknown as BacnetModule;
let bacnetModule = defaultBacnetModule;

export function setBacnetLogger(logger: BacnetLogger) {
  bacnetLogger = logger;
}

export function setBacnetModuleForTests(module: BacnetModule) {
  clientsByPort.clear();
  bacnetLogger = undefined;
  bacnetModule = module;
}

export function resetBacnetClientStateForTests() {
  clientsByPort.clear();
  bacnetLogger = undefined;
  bacnetModule = defaultBacnetModule;
}

export function getBacnetClient(port: number): BacnetClient {
  const p = Number(port) || 47808;

  const existing = clientsByPort.get(p);
  if (existing) return existing;

  const BacnetModule = bacnetModule;
  const client = new BacnetModule({
    port: p,
    apduTimeout: 15000,
    apduSize: 1476, // typical max ethernet APDU
  });

  // Prevent unhandled error events from crashing the app
  client.on('error', (err: any) => {
    bacnetLogger?.error(`[BacnetClient:${p}] Error:`, err);
  });

  clientsByPort.set(p, client);
  return client;
}

export const BacnetEnums = new Proxy({} as Record<string, any>, {
  get(_target, property) {
    return bacnetModule.enum?.[property as keyof typeof bacnetModule.enum];
  },
});
