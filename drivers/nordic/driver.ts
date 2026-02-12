import Homey from 'homey';
import { discoverFlexitUnits } from '../../lib/flexitDiscovery';

export = class FlexitNordicDriver extends Homey.Driver {
  async onInit() {
    const appVersion = this.homey?.manifest?.version ?? this.manifest?.version ?? 'unknown';
    this.log(`Flexit Nordic driver init (app v${appVersion})`);
  }

  async onPairListDevices() {
    const timeoutMs = 5000;
    const burstCount = 10;
    const burstIntervalMs = 300;
    const startedAt = Date.now();
    this.log(
      `[Pair] Discovery start (timeout=${timeoutMs}ms, burstCount=${burstCount}, burstIntervalMs=${burstIntervalMs})`,
    );

    let units;
    try {
      units = await discoverFlexitUnits({
        timeoutMs,
        burstCount,
        burstIntervalMs,
      });
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      this.error(`[Pair] Discovery failed after ${elapsedMs}ms:`, err);
      throw err;
    }

    const elapsedMs = Date.now() - startedAt;
    this.log(`[Pair] Discovery complete: ${units.length} unit(s) found in ${elapsedMs}ms`);

    if (units.length > 0) {
      const summary = units
        .slice(0, 5)
        .map((u) => `${u.serial}@${u.ip}:${u.bacnetPort}`)
        .join(', ');
      this.log(`[Pair] Units: ${summary}${units.length > 5 ? ', ...' : ''}`);
    }

    return units.map((u) => ({
      name: u.name,
      data: {
        id: u.serialNormalized,
        unitId: u.serialNormalized,
      },
      settings: {
        ip: u.ip,
        bacnetPort: u.bacnetPort,
        serial: u.serial,
        mac: u.mac ?? '',
      },
    }));
  }
};
