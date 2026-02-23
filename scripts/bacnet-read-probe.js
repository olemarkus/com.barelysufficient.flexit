#!/usr/bin/env node
/* eslint-disable no-console */
const dgram = require('dgram');
const { EventEmitter } = require('events');
const Bacnet = require('bacstack');

const BacnetEnums = Bacnet.enum;
const ASN1_ARRAY_ALL = BacnetEnums.ASN1_ARRAY_ALL;

class FixedDestinationTransport extends EventEmitter {
  constructor(options) {
    super();
    this._localPort = options.localPort;
    this._localAddress = options.localAddress;
    this._targetPort = options.targetPort;
    this._broadcastAddress = options.broadcastAddress || '255.255.255.255';
    this._server = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this._server.on('message', (msg, rinfo) => this.emit('message', msg, rinfo.address));
    this._server.on('error', (err) => this.emit('error', err));
  }

  getBroadcastAddress() {
    return this._broadcastAddress;
  }

  getMaxPayload() {
    return 1482;
  }

  send(buffer, offset, receiver) {
    this._server.send(buffer, 0, offset, this._targetPort, receiver);
  }

  open() {
    this._server.bind(this._localPort, this._localAddress, () => {
      this._server.setBroadcast(true);
    });
  }

  close() {
    this._server.close();
  }
}

function printUsage() {
  console.log('Read-only BACnet probe (supports proprietary object/property IDs)');
  console.log('');
  console.log('Usage: node scripts/bacnet-read-probe.js --ip <ip> --query <obj:inst:prop[:idx]> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --ip <ipv4>                 Target device IP (required)');
  console.log('  --target-port <port>        Target BACnet UDP port (default 47808)');
  console.log('  --local-port <port>         Local UDP bind port (default 0 = ephemeral)');
  console.log('  --bind <ipv4>               Local bind interface address');
  console.log('  --timeout <ms>              APDU timeout (default 5000)');
  console.log('  --mode <rpm|rp>             readPropertyMultiple (default) or readProperty');
  console.log('  --watch                     Continuously poll until Ctrl+C');
  console.log('  --interval <ms>             Poll interval for watch mode (default 1000)');
  console.log('  --changes-only              In watch mode, print only changed values');
  console.log('  --query <spec>              Query, repeatable');
  console.log('  --json                      Print normalized JSON response');
  console.log('  --help                      Show this help');
  console.log('');
  console.log('Query format:');
  console.log('  <objectType>:<instance>:<propertyId>[:<arrayIndex|all>]');
  console.log('  objectType/propertyId may be numeric or enum name (e.g. DEVICE, MODEL_NAME).');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/bacnet-read-probe.js --ip 192.0.2.10 --query 264:2:4743');
  console.log('  node scripts/bacnet-read-probe.js --ip 192.0.2.10 --query DEVICE:2:SYSTEM_STATUS --query DEVICE:2:DESCRIPTION');
}

function parseNumber(value, label, min = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer, got "${value}"`);
  }
  if (min !== null && parsed < min) throw new Error(`${label} must be >= ${min}, got ${parsed}`);
  return parsed;
}

function enumReverseMap(enumObj) {
  const map = new Map();
  for (const [name, value] of Object.entries(enumObj)) {
    if (typeof value === 'number') map.set(value, name);
  }
  return map;
}

const OBJECT_TYPE_NAMES = enumReverseMap(BacnetEnums.ObjectType);
const PROPERTY_ID_NAMES = enumReverseMap(BacnetEnums.PropertyIdentifier);
const APP_TAG_NAMES = enumReverseMap(BacnetEnums.ApplicationTags);

function normalizeToken(token) {
  return token.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function parseEnumOrNumber(token, enumObj, label) {
  if (/^-?\d+$/.test(token)) return parseNumber(token, label);
  const key = normalizeToken(token);
  const value = enumObj[key];
  if (typeof value === 'number') return value;
  throw new Error(`Unknown ${label} "${token}"`);
}

function parseQuerySpec(spec) {
  const parts = spec.split(':');
  if (parts.length < 3 || parts.length > 4) {
    throw new Error(`Invalid query "${spec}" (expected obj:inst:prop[:idx])`);
  }

  const objectType = parseEnumOrNumber(parts[0], BacnetEnums.ObjectType, 'object type');
  const instance = parseNumber(parts[1], 'object instance', 0);
  const propertyId = parseEnumOrNumber(parts[2], BacnetEnums.PropertyIdentifier, 'property id');

  let index = ASN1_ARRAY_ALL;
  if (parts[3] !== undefined) {
    const raw = parts[3].trim().toLowerCase();
    if (raw !== 'all') index = parseNumber(parts[3], 'array index', 0);
  }

  return {
    objectType,
    instance,
    propertyId,
    index,
  };
}

function parseArgs(argv) {
  const requireValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value after ${flag}`);
    }
    return value;
  };

  const options = {
    ip: '',
    targetPort: 47808,
    localPort: 0,
    bindAddress: undefined,
    timeoutMs: 5000,
    mode: 'rpm',
    watch: false,
    intervalMs: 1000,
    changesOnly: false,
    querySpecs: [],
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--watch') {
      options.watch = true;
      continue;
    }

    if (arg === '--changes-only') {
      options.changesOnly = true;
      continue;
    }

    if (arg === '--ip') {
      options.ip = requireValue(i, '--ip');
      i += 1;
      continue;
    }

    if (arg === '--target-port') {
      options.targetPort = parseNumber(requireValue(i, '--target-port'), 'target port', 1);
      i += 1;
      continue;
    }

    if (arg === '--local-port') {
      options.localPort = parseNumber(requireValue(i, '--local-port'), 'local port', 0);
      i += 1;
      continue;
    }

    if (arg === '--bind') {
      options.bindAddress = requireValue(i, '--bind');
      i += 1;
      continue;
    }

    if (arg === '--timeout') {
      options.timeoutMs = parseNumber(requireValue(i, '--timeout'), 'timeout', 1);
      i += 1;
      continue;
    }

    if (arg === '--interval') {
      options.intervalMs = parseNumber(requireValue(i, '--interval'), 'interval', 1);
      i += 1;
      continue;
    }

    if (arg === '--mode') {
      const mode = String(requireValue(i, '--mode')).toLowerCase();
      if (mode !== 'rpm' && mode !== 'rp') {
        throw new Error(`Invalid mode "${mode}", expected rpm|rp`);
      }
      options.mode = mode;
      i += 1;
      continue;
    }

    if (arg === '--query' || arg === '-q') {
      options.querySpecs.push(requireValue(i, '--query'));
      i += 1;
      continue;
    }

    // Positional convenience: first positional is IP (if missing), remaining are queries.
    if (!arg.startsWith('--')) {
      if (!options.ip) options.ip = arg;
      else options.querySpecs.push(arg);
      continue;
    }

    throw new Error(`Unknown argument "${arg}"`);
  }

  if (!options.ip) throw new Error('Missing --ip');
  if (options.querySpecs.length === 0) throw new Error('At least one --query is required');
  if (options.changesOnly) options.watch = true;

  return {
    ...options,
    queries: options.querySpecs.map(parseQuerySpec),
  };
}

function objectTypeName(id) {
  return OBJECT_TYPE_NAMES.get(id) || String(id);
}

function propertyName(id) {
  return PROPERTY_ID_NAMES.get(id) || String(id);
}

function appTagName(id) {
  return APP_TAG_NAMES.get(id) || String(id);
}

function formatIndex(index) {
  return index === ASN1_ARRAY_ALL ? 'all' : String(index);
}

function normalizePropertyResult(propResult) {
  const id = propResult?.property?.id ?? propResult?.id;
  const index = propResult?.property?.index ?? propResult?.index ?? ASN1_ARRAY_ALL;
  return {
    property: { id, index },
    value: (propResult?.value || []).map(normalizeBacnetValue),
  };
}

function normalizeRpmObjects(objects) {
  return (objects || []).map((objectResult) => ({
    objectId: objectResult?.objectId,
    values: (objectResult?.values || []).map(normalizePropertyResult),
  }));
}

function normalizedValueText(value) {
  if (!value) return '<no-value>';
  if (value.type === 'ERROR') return `ERROR(${value.errorClass}:${value.errorCode})`;
  return `${value.type}=${JSON.stringify(value.value)}`;
}

function renderNormalizedValues(values) {
  if (!Array.isArray(values) || values.length === 0) return '<empty>';
  return values.map(normalizedValueText).join(', ');
}

function snapshotEntryKey(objectId, property) {
  return (
    `${objectTypeName(objectId?.type)}:${objectId?.instance}`
    + ` ${propertyName(property?.id)}(${property?.id})[${formatIndex(property?.index ?? ASN1_ARRAY_ALL)}]`
  );
}

function buildSnapshotFromRpResponses(responses) {
  const snapshot = new Map();
  for (const entry of responses || []) {
    snapshot.set(snapshotEntryKey(entry.objectId, entry.property), entry.values || []);
  }
  return snapshot;
}

function buildSnapshotFromRpmResponse(response) {
  const snapshot = new Map();
  for (const objectResult of response || []) {
    const objectId = objectResult?.objectId || {};
    for (const propResult of objectResult?.values || []) {
      snapshot.set(
        snapshotEntryKey(objectId, propResult?.property || {}),
        propResult?.value || [],
      );
    }
  }
  return snapshot;
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function diffSnapshots(previous, current) {
  const changes = [];
  for (const [key, value] of current.entries()) {
    if (!previous.has(key)) {
      changes.push({ key, kind: 'added', before: undefined, after: value });
      continue;
    }
    const oldValue = previous.get(key);
    if (!valuesEqual(oldValue, value)) {
      changes.push({ key, kind: 'changed', before: oldValue, after: value });
    }
  }
  for (const [key, value] of previous.entries()) {
    if (!current.has(key)) {
      changes.push({ key, kind: 'removed', before: value, after: undefined });
    }
  }
  return changes.sort((a, b) => a.key.localeCompare(b.key));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderBacnetValue(value) {
  if (!value) return '<no-value>';
  if (value.type === BacnetEnums.ApplicationTags.ERROR) {
    return `ERROR(${value.value?.errorClass}:${value.value?.errorCode})`;
  }
  return `${appTagName(value.type)}=${JSON.stringify(value.value)}`;
}

function normalizeBacnetValue(value) {
  if (!value) return null;
  if (value.type === BacnetEnums.ApplicationTags.ERROR) {
    return {
      type: 'ERROR',
      errorClass: value.value?.errorClass,
      errorCode: value.value?.errorCode,
    };
  }
  return {
    type: appTagName(value.type),
    value: value.value,
  };
}

function extractReadPropertyNodes(result) {
  if (!result) return [];
  if (Array.isArray(result.values) && result.values.length > 0) {
    if (typeof result.values[0]?.type === 'number') return result.values;
    if (Array.isArray(result.values[0]?.value)) return result.values[0].value;
  }
  return [];
}

function readProperty(client, ip, query) {
  return new Promise((resolve, reject) => {
    const objectId = { type: query.objectType, instance: query.instance };
    const options = {};
    if (query.index !== ASN1_ARRAY_ALL) options.arrayIndex = query.index;
    client.readProperty(ip, objectId, query.propertyId, options, (err, value) => {
      if (err) return reject(err);
      resolve(value);
    });
  });
}

function readPropertyMultiple(client, ip, queries) {
  const grouped = new Map();
  for (const query of queries) {
    const key = `${query.objectType}:${query.instance}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        objectId: { type: query.objectType, instance: query.instance },
        properties: [],
      });
    }
    grouped.get(key).properties.push({
      id: query.propertyId,
      index: query.index,
    });
  }

  const requestArray = Array.from(grouped.values());
  return new Promise((resolve, reject) => {
    client.readPropertyMultiple(ip, requestArray, {}, (err, value) => {
      if (err) return reject(err);
      resolve({ requestArray, value });
    });
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  const transport = new FixedDestinationTransport({
    localPort: options.localPort,
    localAddress: options.bindAddress,
    targetPort: options.targetPort,
  });

  const client = new Bacnet({
    transport,
    apduTimeout: options.timeoutMs,
    apduSize: 1476,
  });

  client.on('error', (err) => {
    console.error('[Probe] BACnet client error:', err);
  });

  const collectRpPoll = async () => {
    const responses = [];
    for (const query of options.queries) {
      const result = await readProperty(client, options.ip, query);
      const nodes = extractReadPropertyNodes(result);
      responses.push({
        objectId: { type: query.objectType, instance: query.instance },
        property: { id: query.propertyId, index: query.index },
        values: nodes.map(normalizeBacnetValue),
      });
    }
    return { mode: 'rp', responses };
  };

  const collectRpmPoll = async () => {
    const { requestArray, value } = await readPropertyMultiple(client, options.ip, options.queries);
    const response = normalizeRpmObjects(value?.values || []);
    return {
      mode: 'rpm',
      request: requestArray.map((entry) => ({
        objectId: entry.objectId,
        properties: entry.properties,
      })),
      response,
    };
  };

  const collectPoll = async () => (options.mode === 'rp' ? collectRpPoll() : collectRpmPoll());

  const printRpResponses = (responses) => {
    for (const entry of responses || []) {
      console.log(
        `[RP] ${objectTypeName(entry.objectId?.type)}:${entry.objectId?.instance}`
        + ` ${propertyName(entry.property?.id)}(${entry.property?.id})[${formatIndex(entry.property?.index)}]`
        + ` -> ${renderNormalizedValues(entry.values)}`,
      );
    }
  };

  const printRpmResponse = (response) => {
    for (const objectResult of response || []) {
      const objectId = objectResult?.objectId || {};
      console.log(`[RPM] object ${objectTypeName(objectId.type)}:${objectId.instance}`);
      for (const propResult of objectResult?.values || []) {
        console.log(
          `  ${propertyName(propResult.property?.id)}(${propResult.property?.id})`
          + `[${formatIndex(propResult.property?.index)}] -> ${renderNormalizedValues(propResult.value)}`,
        );
      }
    }
  };

  const printPollResult = (result) => {
    if (result.mode === 'rp') printRpResponses(result.responses);
    else printRpmResponse(result.response);
  };

  const pollJsonPayload = (result) => {
    if (result.mode === 'rp') {
      return { mode: 'rp', responses: result.responses };
    }
    return {
      mode: 'rpm',
      request: result.request,
      response: result.response,
    };
  };

  const buildSnapshot = (result) => (
    result.mode === 'rp'
      ? buildSnapshotFromRpResponses(result.responses)
      : buildSnapshotFromRpmResponse(result.response)
  );

  const printChanges = (changes) => {
    for (const change of changes) {
      if (change.kind === 'added') {
        console.log(`[CHANGED] + ${change.key} -> ${renderNormalizedValues(change.after)}`);
      } else if (change.kind === 'removed') {
        console.log(`[CHANGED] - ${change.key} (removed, was ${renderNormalizedValues(change.before)})`);
      } else {
        console.log(
          `[CHANGED] ~ ${change.key}:`
          + ` ${renderNormalizedValues(change.before)} => ${renderNormalizedValues(change.after)}`,
        );
      }
    }
  };

  const watchPolls = async () => {
    let iteration = 0;
    let previous = null;
    let stopRequested = false;
    const stopHandler = () => {
      if (!stopRequested) {
        stopRequested = true;
        console.log('\n[Watch] Stop requested, exiting after current cycle...');
      }
    };
    process.on('SIGINT', stopHandler);
    process.on('SIGTERM', stopHandler);

    try {
      while (!stopRequested) {
        iteration += 1;
        const timestamp = new Date().toISOString();
        try {
          const result = await collectPoll();
          const snapshot = buildSnapshot(result);
          if (options.changesOnly) {
            if (previous === null) {
              console.log(`[Watch] ${timestamp} baseline captured (${snapshot.size} values)`);
              if (options.json) {
                console.log(JSON.stringify({
                  mode: 'watch',
                  kind: 'baseline',
                  timestamp,
                  iteration,
                  size: snapshot.size,
                }, null, 2));
              }
            } else {
              const changes = diffSnapshots(previous, snapshot);
              if (changes.length > 0) {
                console.log(`[Watch] ${timestamp} ${changes.length} change(s)`);
                printChanges(changes);
                if (options.json) {
                  console.log(JSON.stringify({
                    mode: 'watch',
                    kind: 'changes',
                    timestamp,
                    iteration,
                    changes,
                  }, null, 2));
                }
              }
            }
          } else {
            console.log(`[Watch] ${timestamp} poll=${iteration}`);
            printPollResult(result);
            if (options.json) {
              console.log(JSON.stringify(pollJsonPayload(result), null, 2));
            }
          }
          previous = snapshot;
        } catch (error) {
          console.error(`[Watch] ${timestamp} poll failed:`, error?.message || error);
        }
        if (stopRequested) break;
        await sleep(options.intervalMs);
      }
    } finally {
      process.off('SIGINT', stopHandler);
      process.off('SIGTERM', stopHandler);
    }
  };

  console.log(
    `[Probe] target=${options.ip}:${options.targetPort}`
    + ` local=${options.bindAddress || '0.0.0.0'}:${options.localPort}`
    + ` mode=${options.mode} timeoutMs=${options.timeoutMs}`
    + (options.watch
      ? ` watch intervalMs=${options.intervalMs} changesOnly=${options.changesOnly}`
      : ''),
  );
  options.queries.forEach((query) => {
    console.log(
      `[Probe] query ${objectTypeName(query.objectType)}:${query.instance}`
      + ` ${propertyName(query.propertyId)}(${query.propertyId})[${formatIndex(query.index)}]`,
    );
  });

  try {
    if (options.watch) {
      await watchPolls();
    } else {
      const result = await collectPoll();
      printPollResult(result);
      if (options.json) {
        console.log(JSON.stringify(pollJsonPayload(result), null, 2));
      }
    }
  } finally {
    client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[Probe] Failed:', error?.message || error);
    process.exit(1);
  });
}

module.exports = {
  ASN1_ARRAY_ALL,
  FixedDestinationTransport,
  enumReverseMap,
  normalizeToken,
  parseNumber,
  parseEnumOrNumber,
  parseQuerySpec,
  parseArgs,
  objectTypeName,
  propertyName,
  appTagName,
  formatIndex,
  normalizePropertyResult,
  normalizeRpmObjects,
  normalizedValueText,
  renderNormalizedValues,
  snapshotEntryKey,
  buildSnapshotFromRpResponses,
  buildSnapshotFromRpmResponse,
  valuesEqual,
  diffSnapshots,
  sleep,
  renderBacnetValue,
  normalizeBacnetValue,
  extractReadPropertyNodes,
  readProperty,
  readPropertyMultiple,
  main,
};
