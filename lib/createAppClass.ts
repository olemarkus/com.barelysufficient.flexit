import { createRuntimeLogger, RuntimeLogger, runWithLogContext } from './logging';

type HomeyAppBase = new (...args: any[]) => {
  homey: any;
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

type AppDependencies = {
  HomeyApp: HomeyAppBase;
  registry: any;
  isFanProfileMode: (mode: unknown) => boolean;
  normalizeFanProfilePercent: (...args: any[]) => number;
  normalizeFireplaceDurationMinutes: (value: unknown) => number;
  installSourceMapSupport: () => void;
};

export function createFlexitAppClass({
  HomeyApp,
  registry,
  isFanProfileMode,
  normalizeFanProfilePercent,
  normalizeFireplaceDurationMinutes,
  installSourceMapSupport,
}: AppDependencies) {
  installSourceMapSupport();

  return class App extends HomeyApp {
    private runtimeLogger?: RuntimeLogger;

    private getLogger() {
      if (!this.runtimeLogger) {
        this.runtimeLogger = createRuntimeLogger(this, {
          component: 'app',
        });
      }
      return this.runtimeLogger;
    }

    async onInit() {
      const logger = this.getLogger();
      logger.info('app.init', 'Flexit Nordic app initialized');

      registry.setLogger(createRuntimeLogger(this, {
        component: 'registry',
        scope: 'app',
      }));

      this.registerFanSetpointChangedFlowTrigger();
      this.registerHeatingCoilStateFlowTrigger();
      this.registerDehumidificationStateFlowTrigger();
      this.registerFreeCoolingStateFlowTrigger();
      this.registerGlobalErrorHandlers();
      this.registerFanProfileActionCard();
      this.registerFireplaceDurationActionCard();
      this.registerHeatingCoilActionCards();
      this.registerHeatingCoilConditionCard();
      this.registerDehumidificationConditionCard();
      this.registerFreeCoolingConditionCard();
    }

    private registerGlobalErrorHandlers() {
      process.on('uncaughtException', (err) => {
        this.getLogger().error(
          'app.process.uncaught_exception',
          'Unhandled process exception',
          err,
        );
      });
      process.on('unhandledRejection', (reason, _promise) => {
        this.getLogger().error(
          'app.process.unhandled_rejection',
          'Unhandled promise rejection',
          reason,
        );
      });
    }

    private resolveUnitId(device: { getData?: () => { unitId?: unknown } } | undefined) {
      const unitId = String(device?.getData?.()?.unitId ?? '').trim();
      if (!unitId) throw new Error('Device unitId is missing.');
      return unitId;
    }

    private registerFanSetpointChangedFlowTrigger() {
      const supplyFanSetpointChangedCard = this.homey.flow.getDeviceTriggerCard('supply_fan_setpoint_changed');
      const extractFanSetpointChangedCard = this.homey.flow.getDeviceTriggerCard('extract_fan_setpoint_changed');
      registry.setFanSetpointChangedHandler((event: any) => {
        runWithLogContext({
          unitId: this.resolveUnitId(event.device),
          fan: event.fan,
          mode: event.mode,
        }, () => {
          const card = event.fan === 'supply'
            ? supplyFanSetpointChangedCard
            : extractFanSetpointChangedCard;
          card.trigger(
            event.device,
            { setpoint_percent: event.setpointPercent },
          ).catch((error: unknown) => {
            this.getLogger().error(
              'app.flow.trigger.fan_setpoint_changed.failed',
              'Failed to trigger fan setpoint changed flow',
              error,
              { setpointPercent: event.setpointPercent },
            );
          });
        });
      });
    }

    private registerHeatingCoilStateFlowTrigger() {
      const heatingCoilTurnedOnCard = this.homey.flow.getDeviceTriggerCard('heating_coil_turned_on');
      const heatingCoilTurnedOffCard = this.homey.flow.getDeviceTriggerCard('heating_coil_turned_off');
      registry.setHeatingCoilStateChangedHandler((event: any) => {
        runWithLogContext({
          unitId: this.resolveUnitId(event.device),
          enabled: event.enabled,
        }, () => {
          const card = event.enabled
            ? heatingCoilTurnedOnCard
            : heatingCoilTurnedOffCard;
          card.trigger(
            event.device,
            {},
          ).catch((error: unknown) => {
            this.getLogger().error(
              'app.flow.trigger.heating_coil_state.failed',
              'Failed to trigger heating coil state flow',
              error,
            );
          });
        });
      });
    }

    private registerDehumidificationStateFlowTrigger() {
      const dehumidificationActivatedCard = this.homey.flow.getDeviceTriggerCard('dehumidification_activated');
      const dehumidificationDeactivatedCard = this.homey.flow.getDeviceTriggerCard('dehumidification_deactivated');
      registry.setDehumidificationStateChangedHandler((event: any) => {
        runWithLogContext({
          unitId: this.resolveUnitId(event.device),
          active: event.active,
        }, () => {
          const card = event.active
            ? dehumidificationActivatedCard
            : dehumidificationDeactivatedCard;
          card.trigger(
            event.device,
            {},
          ).catch((error: unknown) => {
            this.getLogger().error(
              'app.flow.trigger.dehumidification_state.failed',
              'Failed to trigger dehumidification state flow',
              error,
            );
          });
        });
      });
    }

    private registerFreeCoolingStateFlowTrigger() {
      const freeCoolingActivatedCard = this.homey.flow.getDeviceTriggerCard('free_cooling_activated');
      const freeCoolingDeactivatedCard = this.homey.flow.getDeviceTriggerCard('free_cooling_deactivated');
      registry.setFreeCoolingStateChangedHandler((event: any) => {
        runWithLogContext({
          unitId: this.resolveUnitId(event.device),
          active: event.active,
        }, () => {
          const card = event.active
            ? freeCoolingActivatedCard
            : freeCoolingDeactivatedCard;
          card.trigger(
            event.device,
            {},
          ).catch((error: unknown) => {
            this.getLogger().error(
              'app.flow.trigger.free_cooling_state.failed',
              'Failed to trigger free cooling state flow',
              error,
            );
          });
        });
      });
    }

    private registerFanProfileActionCard() {
      const setFanProfileModeCard = this.homey.flow.getActionCard('set_fan_profile_mode');
      setFanProfileModeCard.registerRunListener(async (args: any) => {
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
        const unitId = this.resolveUnitId(args?.device);

        await registry.setFanProfileMode(
          unitId,
          modeRaw,
          normalizedSupply,
          normalizedExhaust,
        );
        return true;
      });
    }

    private registerFireplaceDurationActionCard() {
      const setFireplaceDurationCard = this.homey.flow.getActionCard('set_fireplace_duration');
      setFireplaceDurationCard.registerRunListener(async (args: any) => {
        const requestedMinutes = normalizeFireplaceDurationMinutes(args?.minutes);
        const unitId = this.resolveUnitId(args?.device);
        await registry.setFireplaceVentilationDuration(unitId, requestedMinutes);
        return true;
      });
    }

    private registerHeatingCoilActionCards() {
      const turnHeatingCoilOnCard = this.homey.flow.getActionCard('turn_heating_coil_on');
      turnHeatingCoilOnCard.registerRunListener(async (args: any) => {
        const unitId = this.resolveUnitId(args?.device);
        await registry.setHeatingCoilEnabled(unitId, true);
        return true;
      });

      const turnHeatingCoilOffCard = this.homey.flow.getActionCard('turn_heating_coil_off');
      turnHeatingCoilOffCard.registerRunListener(async (args: any) => {
        const unitId = this.resolveUnitId(args?.device);
        await registry.setHeatingCoilEnabled(unitId, false);
        return true;
      });

      const toggleHeatingCoilCard = this.homey.flow.getActionCard('toggle_heating_coil_onoff');
      toggleHeatingCoilCard.registerRunListener(async (args: any) => {
        const unitId = this.resolveUnitId(args?.device);
        await registry.toggleHeatingCoilEnabled(unitId);
        return true;
      });
    }

    private registerHeatingCoilConditionCard() {
      const heatingCoilIsOnCard = this.homey.flow.getConditionCard('heating_coil_is_on');
      heatingCoilIsOnCard.registerRunListener(async (args: any) => {
        const unitId = this.resolveUnitId(args?.device);
        return registry.getHeatingCoilEnabled(unitId);
      });
    }

    private registerDehumidificationConditionCard() {
      const dehumidificationIsActiveCard = this.homey.flow.getConditionCard('dehumidification_is_active');
      dehumidificationIsActiveCard.registerRunListener(async (args: any) => {
        const unitId = this.resolveUnitId(args?.device);
        return registry.getDehumidificationActive(unitId);
      });
    }

    private registerFreeCoolingConditionCard() {
      const freeCoolingIsActiveCard = this.homey.flow.getConditionCard('free_cooling_is_active');
      freeCoolingIsActiveCard.registerRunListener(async (args: any) => {
        const unitId = this.resolveUnitId(args?.device);
        return registry.getFreeCoolingActive(unitId);
      });
    }
  };
}
