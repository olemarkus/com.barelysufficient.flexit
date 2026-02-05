export interface DiscoveredFlexitUnit {
  name: string;
  serial: string;
  serialNormalized: string;
  ip: string;
  bacnetPort: number;
  mac?: string;
  fw?: string;
}

const NORDIC_SERIAL_PREFIXES = ['8001', '8002', '8003'];

function isNordicSerial(serialNormalized: string) {
  return NORDIC_SERIAL_PREFIXES.some((prefix) => serialNormalized.startsWith(prefix));
}

/**
 * Best-effort parsing from the proprietary multicast reply payload.
 * We primarily need serial + BACnet endpoint.
 *
 * Serial regex per your prompt: \b\d{6}-\d{6}\b
 * Endpoint regex per your prompt: \b(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\b
 */
export function parseFlexitReply(payload: Buffer, rinfoAddress: string): DiscoveredFlexitUnit | null {
  // Replace non-printable bytes with spaces so regex works reliably.
  const ascii = payload
    .toString('latin1')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .trim();

  const serialMatch = ascii.match(/\b\d{6}-\d{6}\b/);
  if (!serialMatch) return null;
  const serial = serialMatch[0];
  const serialNormalized = serial.replace(/[^0-9]/g, '');
  if (!isNordicSerial(serialNormalized)) return null;

  const endpointMatch = ascii.match(/\b(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\b/);
  const ip = endpointMatch?.[1] ?? rinfoAddress;
  const bacnetPort = endpointMatch ? Number(endpointMatch[2]) : 47808;

  const mac = ascii.match(/\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/)?.[0];

  // Best-effort "friendly name"
  const tokens = ascii.split(/\s+/).filter(Boolean);
  const name = tokens.find((t) => t.includes('_') && !t.includes('.') && !t.includes(':') && t.length >= 4)
    ?? tokens.find((t) => /^[A-Za-z][A-Za-z0-9_]{3,}$/.test(t) && !t.includes(':') && !t.includes('.'))
    ?? 'Flexit Unit';

  const fw = ascii.match(/\bFW[:=]?[A-Za-z0-9._-]+\b/i)?.[0];

  return {
    name, serial, serialNormalized, ip, bacnetPort, mac, fw,
  };
}
