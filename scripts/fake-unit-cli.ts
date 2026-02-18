export interface CliRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
}

export function usage() {
  console.log('Usage: ts-node scripts/fake-unit-cli.ts <command> [args] [--api <url>]');
  console.log('');
  console.log('Feature commands:');
  console.log('  status | summary');
  console.log('  mode <away|home|high|fireplace>');
  console.log('  setpoint <value> [home|away]');
  console.log('  rapid [minutes]');
  console.log('  fireplace [minutes]');
  console.log('  filter status');
  console.log('  filter age <hours>');
  console.log('  filter limit <hours>');
  console.log('  filter replace');
  console.log('');
  console.log('Debug commands:');
  console.log('  state');
  console.log('  points');
  console.log('  advance <seconds>');
  console.log('  write <type> <instance> <value> [priority]');
}

export function parseApiBase(argv: string[]): { args: string[]; apiBase: string } {
  const args = [...argv];
  const idx = args.findIndex((entry) => entry === '--api');
  if (idx >= 0) {
    const value = args[idx + 1];
    const hasValue = Boolean(value && !value.startsWith('--'));
    args.splice(idx, hasValue ? 2 : 1);
    if (hasValue) {
      return { args, apiBase: value as string };
    }
    return { args, apiBase: 'http://127.0.0.1:18080' };
  }
  return { args, apiBase: process.env.FLEXIT_FAKE_API ?? 'http://127.0.0.1:18080' };
}

export async function callApi(base: string, request: CliRequest): Promise<any> {
  const response = await fetch(`${base}${request.path}`, {
    method: request.method,
    headers: { 'content-type': 'application/json' },
    body: request.body ? JSON.stringify(request.body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text || '<empty>'}`);
  }
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(`Failed to parse API response as JSON. Body: ${text}`);
  }
}

export function parseNumber(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be numeric`);
  }
  return parsed;
}

export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export function printSummary(payload: any) {
  const summary = payload?.summary;
  if (!summary) {
    printJson(payload);
    return;
  }

  console.log(`Mode: ${summary.mode}`);
  console.log(`Setpoints: home=${summary.setpoints.home}C away=${summary.setpoints.away}C`);
  console.log(
    `Temps: supply=${summary.temperatures.supply}C extract=${summary.temperatures.extract}C`
    + ` outdoor=${summary.temperatures.outdoor}C room=${summary.temperatures.room}C`,
  );
  console.log(`Humidity: extract=${summary.humidity.extract}% room=${summary.humidity.room}%`);
  console.log(
    `Fan: supply=${summary.fan.supplyPercent}%/${summary.fan.supplyRpm}rpm`
    + ` extract=${summary.fan.extractPercent}%/${summary.fan.extractRpm}rpm`,
  );
  console.log(
    `Filter: ${summary.filter.remainingPercent}% remaining`
    + ` (${summary.filter.operatingHours}/${summary.filter.limitHours} h)`,
  );
  console.log(
    `Timers: rapid=${summary.timers.rapidMinutes}m fireplace=${summary.timers.fireplaceMinutes}m`
    + ` away-delay=${summary.timers.awayDelayMinutes}m`,
  );
}

export async function printLatestSummary(apiBase: string) {
  printSummary(await callApi(apiBase, { method: 'GET', path: '/summary' }));
}

export async function runFeatureCommand(apiBase: string, command: string, args: string[]): Promise<boolean> {
  if (command === 'status' || command === 'summary') {
    const payload = await callApi(apiBase, { method: 'GET', path: '/summary' });
    printSummary(payload);
    return true;
  }

  if (command === 'mode') {
    const mode = args[0];
    if (!mode) throw new Error('mode is required');
    await callApi(apiBase, { method: 'POST', path: '/feature/mode', body: { mode } });
    await printLatestSummary(apiBase);
    return true;
  }

  if (command === 'setpoint') {
    const value = parseNumber(args[0], 'setpoint');
    const target = args[1] === 'away' ? 'away' : 'home';
    await callApi(apiBase, { method: 'POST', path: '/feature/setpoint', body: { value, target } });
    await printLatestSummary(apiBase);
    return true;
  }

  if (command === 'rapid') {
    const minutes = args[0] === undefined ? undefined : parseNumber(args[0], 'minutes');
    await callApi(apiBase, { method: 'POST', path: '/feature/rapid/start', body: { minutes } });
    await printLatestSummary(apiBase);
    return true;
  }

  if (command === 'fireplace') {
    const minutes = args[0] === undefined ? undefined : parseNumber(args[0], 'minutes');
    await callApi(apiBase, { method: 'POST', path: '/feature/fireplace/start', body: { minutes } });
    await printLatestSummary(apiBase);
    return true;
  }

  if (command === 'filter') {
    const sub = args[0];
    if (!sub || sub === 'status') {
      const summary = await callApi(apiBase, { method: 'GET', path: '/summary' });
      const filter = summary?.summary?.filter;
      if (!filter) {
        printJson(summary);
        return true;
      }
      console.log(`Filter: ${filter.remainingPercent}% remaining (${filter.operatingHours}/${filter.limitHours} h)`);
      return true;
    }

    if (sub === 'replace') {
      await callApi(apiBase, { method: 'POST', path: '/feature/filter/replace' });
      await printLatestSummary(apiBase);
      return true;
    }

    if (sub === 'age') {
      const operatingHours = parseNumber(args[1], 'hours');
      await callApi(apiBase, { method: 'POST', path: '/feature/filter/set', body: { operatingHours } });
      await printLatestSummary(apiBase);
      return true;
    }

    if (sub === 'limit') {
      const limitHours = parseNumber(args[1], 'hours');
      await callApi(apiBase, { method: 'POST', path: '/feature/filter/set', body: { limitHours } });
      await printLatestSummary(apiBase);
      return true;
    }

    throw new Error(`Unknown filter command: ${sub}`);
  }

  return false;
}

export async function main(argv = process.argv.slice(2)) {
  const { args, apiBase } = parseApiBase(argv);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }

  const handledFeature = await runFeatureCommand(apiBase, command, args.slice(1));
  if (handledFeature) return;

  switch (command) {
    case 'state':
      printJson(await callApi(apiBase, { method: 'GET', path: '/debug/state' }));
      return;
    case 'points':
      printJson(await callApi(apiBase, { method: 'GET', path: '/debug/points' }));
      return;
    case 'advance': {
      const seconds = parseNumber(args[1], 'seconds');
      printJson(await callApi(apiBase, { method: 'POST', path: '/debug/advance', body: { seconds } }));
      return;
    }
    case 'write': {
      const type = parseNumber(args[1], 'type');
      const instance = parseNumber(args[2], 'instance');
      const value = parseNumber(args[3], 'value');
      const priorityArg = args[4];
      const priority = priorityArg === undefined ? undefined : parseNumber(priorityArg, 'priority');
      printJson(await callApi(apiBase, {
        method: 'POST',
        path: '/debug/write',
        body: {
          type, instance, value, priority,
        },
      }));
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

const isMainModule = typeof require !== 'undefined'
  && typeof module !== 'undefined'
  && require.main === module;

if (isMainModule) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
