const NORDIC_MODELS: Record<number, string> = {
  800111: 'S2 REL',
  800121: 'S3 REL',
  800110: 'S2 RER',
  800120: 'S3 RER',
  800221: 'CL4 REL',
  800220: 'CL4 RER',
  800130: 'S4 RER',
  800131: 'S4 REL',
  800210: 'CL2 RER',
  800211: 'CL2 REL',
  800200: 'CL3 RER',
  800201: 'CL3 REL',
  800300: 'KS3 RER',
  800301: 'KS3 REL',
};

export function getNordicModelFromSerial(serial: string): string | null {
  const normalized = serial.replace(/[^0-9]/g, '');
  if (normalized.length < 6) return null;
  const modelKey = Number(normalized.slice(0, 6));
  return NORDIC_MODELS[modelKey] ?? null;
}
