import Homey from 'homey';
import { discoverFlexitUnits } from '../../lib/flexitDiscovery';
import { createRuntimeLogger, RuntimeLogger, runWithLogContext } from '../../lib/logging';

export = class FlexitNordicDriver extends Homey.Driver {
  private runtimeLogger?: RuntimeLogger;

  private getLogger() {
    if (!this.runtimeLogger) {
      this.runtimeLogger = createRuntimeLogger(this, {
        component: 'driver',
        transport: 'bacnet',
      });
    }
    return this.runtimeLogger;
  }

  async onInit() {
    const appVersion = this.homey?.manifest?.version ?? this.manifest?.version ?? 'unknown';
    this.getLogger().info('driver.init', 'Flexit Nordic BACnet driver initialized', { appVersion });
  }

  async onPairListDevices() {
    const timeoutMs = 5000;
    const burstCount = 10;
    const burstIntervalMs = 300;
    const startedAt = Date.now();
    const logger = this.getLogger().child({ pairing: true });
    logger.info('driver.pair.discovery.start', 'Starting BACnet pairing discovery', {
      timeoutMs,
      burstCount,
      burstIntervalMs,
    });

    let units;
    try {
      units = await runWithLogContext({
        operation: 'pair-discovery',
        transport: 'bacnet',
      }, () => discoverFlexitUnits({
        timeoutMs,
        burstCount,
        burstIntervalMs,
        logger: logger.child({ component: 'discovery' }),
      }));
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      logger.error('driver.pair.discovery.failed', 'BACnet pairing discovery failed', err, {
        elapsedMs,
      });
      throw err;
    }

    const elapsedMs = Date.now() - startedAt;
    const existingUnitIds = new Set(
      this.getDevices()
        .map((device: any) => device?.getData?.()?.unitId ?? device?.getData?.()?.id)
        .filter((unitId: unknown): unitId is string => typeof unitId === 'string' && unitId.length > 0),
    );
    logger.info('driver.pair.discovery.complete', 'BACnet pairing discovery completed', {
      elapsedMs,
      unitCount: units.length,
      units: units.map((unit: any) => ({
        unitId: unit.serialNormalized,
        serial: unit.serial,
        ip: unit.ip,
        bacnetPort: unit.bacnetPort,
        status: existingUnitIds.has(unit.serialNormalized) ? 'already_added' : 'new',
      })),
    });

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
