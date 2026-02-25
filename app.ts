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

    Registry.setLogger({
      log: (...args: any[]) => this.log(...args),
      warn: (...args: any[]) => this.log(...args),
      error: (...args: any[]) => this.error(...args),
    });

    this.registerFanSetpointChangedFlowTrigger();
    this.registerHeatingCoilStateFlowTrigger();
    this.registerGlobalErrorHandlers();
    this.registerFanProfileActionCard();
    this.registerHeatingCoilActionCards();
    this.registerHeatingCoilConditionCard();
  }

  private registerGlobalErrorHandlers() {
    process.on('uncaughtException', (err) => {
      this.error('Uncaught Exception:', err);
    });
    process.on('unhandledRejection', (reason, _promise) => {
      this.error('Unhandled Rejection:', reason);
    });
  }

  private resolveUnitId(device: Homey.Device | undefined) {
    const unitId = String((device as any)?.getData?.()?.unitId ?? '').trim();
    if (!unitId) throw new Error('Device unitId is missing.');
    return unitId;
  }

  private registerFanSetpointChangedFlowTrigger() {
    const supplyFanSetpointChangedCard = this.homey.flow.getDeviceTriggerCard('supply_fan_setpoint_changed');
    const extractFanSetpointChangedCard = this.homey.flow.getDeviceTriggerCard('extract_fan_setpoint_changed');
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
  }

  private registerHeatingCoilStateFlowTrigger() {
    const heatingCoilTurnedOnCard = this.homey.flow.getDeviceTriggerCard('heating_coil_turned_on');
    const heatingCoilTurnedOffCard = this.homey.flow.getDeviceTriggerCard('heating_coil_turned_off');
    Registry.setHeatingCoilStateChangedHandler((event) => {
      const card = event.enabled
        ? heatingCoilTurnedOnCard
        : heatingCoilTurnedOffCard;
      card.trigger(
        event.device as unknown as Homey.Device,
        {},
      ).catch((error: unknown) => {
        this.error('Failed to trigger heating coil state flow:', error);
      });
    });
  }

  private registerFanProfileActionCard() {
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
      const unitId = this.resolveUnitId(device);

      await Registry.setFanProfileMode(
        unitId,
        modeRaw,
        normalizedSupply,
        normalizedExhaust,
      );
      return true;
    });
  }

  private registerHeatingCoilActionCards() {
    const turnHeatingCoilOnCard = this.homey.flow.getActionCard('turn_heating_coil_on');
    turnHeatingCoilOnCard.registerRunListener(async (args: any) => {
      const device = args?.device as Homey.Device | undefined;
      const unitId = this.resolveUnitId(device);
      await Registry.setHeatingCoilEnabled(unitId, true);
      return true;
    });

    const turnHeatingCoilOffCard = this.homey.flow.getActionCard('turn_heating_coil_off');
    turnHeatingCoilOffCard.registerRunListener(async (args: any) => {
      const device = args?.device as Homey.Device | undefined;
      const unitId = this.resolveUnitId(device);
      await Registry.setHeatingCoilEnabled(unitId, false);
      return true;
    });

    const toggleHeatingCoilCard = this.homey.flow.getActionCard('toggle_heating_coil_onoff');
    toggleHeatingCoilCard.registerRunListener(async (args: any) => {
      const device = args?.device as Homey.Device | undefined;
      const unitId = this.resolveUnitId(device);
      await Registry.toggleHeatingCoilEnabled(unitId);
      return true;
    });
  }

  private registerHeatingCoilConditionCard() {
    const heatingCoilIsOnCard = this.homey.flow.getConditionCard('heating_coil_is_on');
    heatingCoilIsOnCard.registerRunListener(async (args: any) => {
      const device = args?.device as Homey.Device | undefined;
      const unitId = this.resolveUnitId(device);
      return Registry.getHeatingCoilEnabled(unitId);
    });
  }
};
