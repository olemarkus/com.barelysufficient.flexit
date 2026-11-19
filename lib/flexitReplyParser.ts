import { getNordicModelFromSerial } from './flexitModel';

export interface DiscoveredFlexitUnit {
  name: string;
  model?: string;
  serial: string;
  serialNormalized: string;
  ip: string;
  bacnetPort: number;
  mac?: string;
  fw?: string;
}

const NORDIC_UNIT_SERIAL = /\b800[123]\d{2}-\d{6}\b/;
const NORDIC_CONTROLLER_SERIAL = /\b116400-[0-9a-f]{10}\b/i;

/** Extract the unit identity and BACnet endpoint from a multicast discovery reply. */
export function parseFlexitReply(payload: Buffer, rinfoAddress: string): DiscoveredFlexitUnit | null {
  // Replace non-printable bytes with spaces so regex works reliably.
  const ascii = payload
    .toString('latin1')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .trim();

  // Prefer the unit serial when a controller also advertises its own identity.
  const serialMatch = ascii.match(NORDIC_UNIT_SERIAL) ?? ascii.match(NORDIC_CONTROLLER_SERIAL);
  if (!serialMatch) return null;
  const serial = serialMatch[0];
  const serialNormalized = serial.replace('-', '').toUpperCase();
  const model = getNordicModelFromSerial(serialNormalized);

  const endpointMatch = ascii.match(/\b(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\b/);
  const ip = endpointMatch?.[1] ?? rinfoAddress;
  const bacnetPort = endpointMatch ? Number(endpointMatch[2]) : 47808;

  const mac = ascii.match(/\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/)?.[0];

  // Best-effort "friendly name"
  const tokens = ascii.split(/\s+/).filter(Boolean);
  const friendlyName = tokens.find((t) => t.includes('_') && !t.includes('.') && !t.includes(':') && t.length >= 4)
    ?? tokens.find((t) => /^[A-Za-z][A-Za-z0-9_]{3,}$/.test(t) && !t.includes(':') && !t.includes('.'))
    ?? 'Flexit Unit';
  const name = model ? `Nordic ${model}` : friendlyName;

  const fw = ascii.match(/\bFW[:=]?[A-Za-z0-9._-]+\b/i)?.[0];

  return {
    name, model: model ?? undefined, serial, serialNormalized, ip, bacnetPort, mac, fw,
  };
}
