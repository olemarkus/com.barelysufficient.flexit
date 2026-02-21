import sourceMapSupport from 'source-map-support';

import Homey from 'homey';
import {
  Registry,
  isFanProfileMode,
  normalizeFanProfilePercent,
} from './lib/UnitRegistry';

sourceMapSupport.install();

// NOTE: Homey expects CommonJS export for App/Driver/Device classes.
// Avoid `export default` for runtime compatibility.
export = class App extends Homey.App {
  async onInit() {
    this.log('Flexit Nordic app init');
    const supplyFanSetpointChangedCard = this.homey.flow.getDeviceTriggerCard('supply_fan_setpoint_changed');
    const extractFanSetpointChangedCard = this.homey.flow.getDeviceTriggerCard('extract_fan_setpoint_changed');
    Registry.setLogger({
      log: (...args: any[]) => this.log(...args),
      warn: (...args: any[]) => this.log(...args),
      error: (...args: any[]) => this.error(...args),
    });
    Registry.setFanSetpointChangedHandler((event) => {
      const card = event.fan === 'supply'
        ? supplyFanSetpointChangedCard
        : extractFanSetpointChangedCard;
      card.trigger(
        event.device as unknown as Homey.Device,
        { setpoint_percent: event.setpointPercent },
      ).catch((error: unknown) => {
        this.error('Failed to trigger fan setpoint changed flow:', error);
      });
    });

    process.on('uncaughtException', (err) => {
      this.error('Uncaught Exception:', err);
    });

    process.on('unhandledRejection', (reason, _promise) => {
      this.error('Unhandled Rejection:', reason);
    });

    const resolveUnitId = (device: Homey.Device | undefined) => {
      const unitId = String((device as any)?.getData?.()?.unitId ?? '').trim();
      if (!unitId) throw new Error('Device unitId is missing.');
      return unitId;
    };

    const setFanProfileModeCard = this.homey.flow.getActionCard('set_fan_profile_mode');
    setFanProfileModeCard.registerRunListener(async (args: any) => {
      const device = args?.device as Homey.Device | undefined;
      const modeRaw = String(args?.mode ?? '').trim();
      if (!isFanProfileMode(modeRaw)) {
        throw new Error(`Unsupported mode '${modeRaw}'.`);
      }

      const supplyPercent = Number(args?.supply_percent);
      const exhaustPercent = Number(args?.exhaust_percent);
      if (!Number.isFinite(supplyPercent) || !Number.isFinite(exhaustPercent)) {
        throw new Error('Supply and exhaust values must be numeric.');
      }
      const normalizedSupply = normalizeFanProfilePercent(supplyPercent, modeRaw, 'supply');
      const normalizedExhaust = normalizeFanProfilePercent(exhaustPercent, modeRaw, 'exhaust');

      const unitId = resolveUnitId(device);

      await Registry.setFanProfileMode(
        unitId,
        modeRaw,
        normalizedSupply,
        normalizedExhaust,
      );
      return true;
    });
  }
};
