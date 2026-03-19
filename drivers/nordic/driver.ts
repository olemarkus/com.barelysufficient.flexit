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
        log: (...args: any[]) => this.log(...args),
        error: (...args: any[]) => this.error(...args),
      });
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      this.error(`[Pair] Discovery failed after ${elapsedMs}ms:`, err);
      throw err;
    }

    const elapsedMs = Date.now() - startedAt;
    this.log(`[Pair] Discovery complete: ${units.length} unit(s) found in ${elapsedMs}ms`);

    if (units.length > 0) {
      const existingUnitIds = new Set(
        this.getDevices()
          .map((device: any) => device?.getData?.()?.unitId ?? device?.getData?.()?.id)
          .filter((unitId: unknown): unitId is string => typeof unitId === 'string' && unitId.length > 0),
      );

      for (const unit of units) {
        const status = existingUnitIds.has(unit.serialNormalized) ? 'already added' : 'new';
        this.log(`[Pair] Unit ${unit.serial}@${unit.ip}:${unit.bacnetPort} (${status})`);
      }
    }

    return units.map((u) => ({
      name: u.name,
      data: {
        id: u.serialNormalized,
        unitId: u.serialNormalized,
      },
      settings: {
        ip: u.ip,
        // Connection settings are labels, so store as strings.
        bacnetPort: String(u.bacnetPort),
        serial: u.serial,
        mac: u.mac ?? '',
      },
    }));
  }
};
