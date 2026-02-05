/**
 * Shared bacstack client(s) per local UDP port, to avoid multiple instances
 * binding the same port when you have multiple devices.
 */
const Bacnet = require('bacstack');

type BacnetClient = any;

const clientsByPort = new Map<number, BacnetClient>();

export function getBacnetClient(port: number): BacnetClient {
  const p = Number(port) || 47808;

  const existing = clientsByPort.get(p);
  if (existing) return existing;

  const client = new Bacnet({
    port: p,
    apduTimeout: 10000,
    apduSize: 1476, // typical max ethernet APDU
  });

  // Prevent unhandled error events from crashing the app
  client.on('error', (err: any) => {
    console.error(`[BacnetClient:${p}] Error:`, err);
  });

  clientsByPort.set(p, client);
  return client;
}

export const BacnetEnums = Bacnet.enum;
