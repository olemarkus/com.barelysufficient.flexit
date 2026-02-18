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

  console.log(
    `[Probe] target=${options.ip}:${options.targetPort}`
    + ` local=${options.bindAddress || '0.0.0.0'}:${options.localPort}`
    + ` mode=${options.mode} timeoutMs=${options.timeoutMs}`,
  );
  options.queries.forEach((query) => {
    console.log(
      `[Probe] query ${objectTypeName(query.objectType)}:${query.instance}`
      + ` ${propertyName(query.propertyId)}(${query.propertyId})[${formatIndex(query.index)}]`,
    );
  });

  try {
    if (options.mode === 'rp') {
      const out = [];
      for (const query of options.queries) {
        const result = await readProperty(client, options.ip, query);
        const nodes = extractReadPropertyNodes(result);
        const line = nodes.map(renderBacnetValue).join(', ');
        console.log(
          `[RP] ${objectTypeName(query.objectType)}:${query.instance}`
          + ` ${propertyName(query.propertyId)}(${query.propertyId})[${formatIndex(query.index)}]`
          + ` -> ${line || '<empty>'}`,
        );

        out.push({
          objectId: { type: query.objectType, instance: query.instance },
          property: { id: query.propertyId, index: query.index },
          values: nodes.map(normalizeBacnetValue),
        });
      }

      if (options.json) {
        console.log(JSON.stringify({ mode: 'rp', responses: out }, null, 2));
      }
    } else {
      const { requestArray, value } = await readPropertyMultiple(client, options.ip, options.queries);
      const objects = value?.values || [];

      for (const objectResult of objects) {
        const objectId = objectResult?.objectId || {};
        console.log(`[RPM] object ${objectTypeName(objectId.type)}:${objectId.instance}`);
        for (const propResult of objectResult?.values || []) {
          const id = propResult?.property?.id ?? propResult?.id;
          const index = propResult?.property?.index ?? propResult?.index ?? ASN1_ARRAY_ALL;
          const nodes = Array.isArray(propResult?.value) ? propResult.value : [];
          const line = nodes.map(renderBacnetValue).join(', ');
          console.log(
            `  ${propertyName(id)}(${id})[${formatIndex(index)}] -> ${line || '<empty>'}`,
          );
        }
      }

      if (options.json) {
        const normalized = {
          mode: 'rpm',
          request: requestArray.map((entry) => ({
            objectId: entry.objectId,
            properties: entry.properties,
          })),
          response: objects.map((objectResult) => ({
            objectId: objectResult.objectId,
            values: (objectResult.values || []).map((propResult) => ({
              property: {
                id: propResult?.property?.id ?? propResult?.id,
                index: propResult?.property?.index ?? propResult?.index ?? ASN1_ARRAY_ALL,
              },
              value: (propResult.value || []).map(normalizeBacnetValue),
            })),
          })),
        };
        console.log(JSON.stringify(normalized, null, 2));
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
  renderBacnetValue,
  normalizeBacnetValue,
  extractReadPropertyNodes,
  readProperty,
  readPropertyMultiple,
  main,
};
