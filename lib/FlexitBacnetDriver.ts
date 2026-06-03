import Homey from 'homey';
import { discoverFlexitUnits } from './flexitDiscovery';
import { FlexitSeries, getSeriesLabel } from './flexitModel';
import { createRuntimeLogger, RuntimeLogger, runWithLogContext } from './logging';

/**
 * Shared BACnet (local) pairing driver. Concrete drivers only declare which product
 * series they own; discovery, series gating, logging and device mapping live here so
 * the Nordic and EcoNordic local drivers never duplicate this logic.
 */
export abstract class FlexitBacnetDriver extends Homey.Driver {
  protected abstract readonly series: FlexitSeries;

  private runtimeLogger?: RuntimeLogger;

  protected getLogger() {
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
    this.getLogger().info(
      'driver.init',
      `Flexit ${getSeriesLabel(this.series)} BACnet driver initialized`,
      { appVersion },
    );
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
    const seriesUnits = units.filter((unit) => unit.series === this.series);
    const existingUnitIds = new Set(
      this.getDevices()
        .map((device: any) => device?.getData?.()?.unitId ?? device?.getData?.()?.id)
        .filter((unitId: unknown): unitId is string => typeof unitId === 'string' && unitId.length > 0),
    );
    logger.info('driver.pair.discovery.complete', 'BACnet pairing discovery completed', {
      elapsedMs,
      unitCount: units.length,
      matchedCount: seriesUnits.length,
      units: units.map((unit: any) => ({
        unitId: unit.serialNormalized,
        serial: unit.serial,
        series: unit.series,
        ip: unit.ip,
        bacnetPort: unit.bacnetPort,
        matchesDriver: unit.series === this.series,
        status: existingUnitIds.has(unit.serialNormalized) ? 'already_added' : 'new',
      })),
    });

    return seriesUnits.map((u) => ({
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
}
