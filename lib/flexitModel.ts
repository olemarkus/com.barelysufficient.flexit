export type FlexitSeries = 'nordic' | 'econordic';

// The first six digits of a Flexit serial encode the model.
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

// EcoNordic heat-pump units (W4 / WH4 / WH4 XL — ventilation + heat pump + hot water).
//
// UNKNOWN until a real EcoNordic serial is captured (see plan Phase 0 / localdocs).
// No public source documents the EcoNordic 6-digit model codes, and EcoNordic uses a
// different register map from the Nordic CI66 series, so a recognized EcoNordic unit must
// NOT reuse the Nordic datapoint instances verbatim. Populate from a real unit before
// relying on this for anything beyond routing pairing to the EcoNordic driver.
const ECONORDIC_MODELS: Record<number, string> = {
  // <6-digit prefix>: 'W4',
  // <6-digit prefix>: 'WH4',
};

const NORDIC_SERIAL_PREFIXES = ['8001', '8002', '8003'];
// UNKNOWN until a real EcoNordic serial is captured (see ECONORDIC_MODELS note above).
const ECONORDIC_SERIAL_PREFIXES: string[] = [];

function normalizeSerial(serial: string): string {
  return serial.replace(/[^0-9]/g, '');
}

function modelFromSerial(serial: string, table: Record<number, string>): string | null {
  const normalized = normalizeSerial(serial);
  if (normalized.length < 6) return null;
  return table[Number(normalized.slice(0, 6))] ?? null;
}

function matchesAnyPrefix(serialNormalized: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => serialNormalized.startsWith(prefix));
}

export function getNordicModelFromSerial(serial: string): string | null {
  return modelFromSerial(serial, NORDIC_MODELS);
}

export function getEcoNordicModelFromSerial(serial: string): string | null {
  return modelFromSerial(serial, ECONORDIC_MODELS);
}

/**
 * Classify a Flexit serial into a supported product series, or null when unrecognized.
 *
 * Recognition is by the 6-digit serial prefix block (the same block that encodes the
 * model). EcoNordic prefixes are not yet known, so EcoNordic classification stays inert
 * until ECONORDIC_SERIAL_PREFIXES is populated from a real unit — at which point matching
 * units are routed to the EcoNordic driver without any other call-site changes.
 */
export function classifyFlexitSerial(serial: string): FlexitSeries | null {
  const normalized = normalizeSerial(serial);
  if (normalized.length < 6) return null;
  if (matchesAnyPrefix(normalized, NORDIC_SERIAL_PREFIXES)) return 'nordic';
  if (matchesAnyPrefix(normalized, ECONORDIC_SERIAL_PREFIXES)) return 'econordic';
  return null;
}

export function getModelFromSerial(serial: string, series: FlexitSeries): string | null {
  return series === 'econordic'
    ? getEcoNordicModelFromSerial(serial)
    : getNordicModelFromSerial(serial);
}

/**
 * Whether a plant/unit with `serial` should appear in the pairing list of the driver
 * for `series`. This is the single place the unknown-serial policy lives:
 *
 * - The Nordic driver also adopts unrecognized serials, so introducing model gating
 *   never hides a plant that would have listed before EcoNordic support existed.
 * - The EcoNordic driver adopts only serials positively classified as EcoNordic.
 */
export function serialMatchesDriverSeries(serial: string, series: FlexitSeries): boolean {
  const classified = classifyFlexitSerial(serial);
  return series === 'econordic'
    ? classified === 'econordic'
    : classified !== 'econordic';
}

const SERIES_LABELS: Record<FlexitSeries, string> = {
  nordic: 'Nordic',
  econordic: 'EcoNordic',
};

/** Human-facing product-line label, e.g. for device names and log messages. */
export function getSeriesLabel(series: FlexitSeries): string {
  return SERIES_LABELS[series];
}
