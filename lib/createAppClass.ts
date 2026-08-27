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
  normalizeHighDurationMinutes: (value: unknown) => number;
  installSourceMapSupport: () => void;
};

const WIDGET_DRIVER_IDS = ['nordic', 'nordic-cloud'] as const;

type WidgetDevice = {
  id?: unknown;
  driver?: { id?: unknown };
  getId?: () => unknown;
  getName?: () => string;
  getAvailable?: () => boolean;
  getData?: () => {
    id?: unknown;
    unitId?: unknown;
    driverId?: unknown;
  };
};

export function createFlexitAppClass({
  HomeyApp,
  registry,
  isFanProfileMode,
  normalizeFanProfilePercent,
  normalizeFireplaceDurationMinutes,
  normalizeHighDurationMinutes,
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
      this.registerVentilationStoppedStateFlowTrigger();
      this.registerGlobalErrorHandlers();
      this.registerFanProfileActionCard();
      this.registerFireplaceDurationActionCard();
      this.registerHighDurationActionCard();
      this.registerTemporaryHighActionCard();
      this.registerStopVentilationActionCard();
      this.registerHeatingCoilActionCards();
      this.registerHeatingCoilConditionCard();
      this.registerDehumidificationConditionCard();
      this.registerFreeCoolingConditionCard();
      this.registerVentilationStoppedConditionCard();
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

    getVentilationModesWidgetStatus(deviceId?: unknown) {
      const device = this.resolveWidgetDevice(deviceId);
      if (!device) {
        return {
          state: 'no_device',
          message: 'Select a Flexit ventilation device.',
          devices: this.getWidgetDeviceOptions(),
        };
      }

      const identity = this.getWidgetDeviceIdentity(device);
      if (!identity) {
        return {
          state: 'unavailable',
          generatedAt: new Date().toISOString(),
          message: 'Ventilation status is not available yet.',
        };
      }

      try {
        return {
          state: 'ready',
          generatedAt: new Date().toISOString(),
          device: identity,
          ...registry.getModeWidgetSnapshot(identity.unitId),
        };
      } catch (error) {
        this.getLogger().error(
          'app.widget.ventilation_modes.status.failed',
          'Failed to read ventilation modes widget status',
          error,
          { unitId: identity.unitId },
        );
        return {
          state: 'unavailable',
          generatedAt: new Date().toISOString(),
          device: identity,
          message: 'Ventilation status is not available yet.',
        };
      }
    }

    private resolveWidgetDevice(deviceId: unknown): WidgetDevice | undefined {
      const devices = this.getWidgetDevices();
      const requestedId = this.normalizeWidgetDeviceId(deviceId);
      if (!requestedId) return devices.length === 1 ? devices[0] : undefined;
      return devices.find((device) => this.widgetDeviceMatches(device, requestedId));
    }

    private getWidgetDevices(): WidgetDevice[] {
      const devices: WidgetDevice[] = [];
      for (const driverId of WIDGET_DRIVER_IDS) {
        try {
          const driver = this.homey.drivers.getDriver(driverId);
          devices.push(...driver.getDevices());
        } catch (error) {
          this.getLogger().error(
            'app.widget.ventilation_modes.driver_lookup.failed',
            'Failed to enumerate widget devices for driver',
            error,
            { driverId },
          );
        }
      }
      return devices;
    }

    private normalizeWidgetDeviceId(deviceId: unknown): string {
      const first = Array.isArray(deviceId) ? deviceId[0] : deviceId;
      return String(first ?? '').trim();
    }

    private widgetDeviceMatches(device: WidgetDevice, requestedId: string): boolean {
      return this.getWidgetDeviceCandidateIds(device).includes(requestedId);
    }

    private getWidgetDeviceCandidateIds(device: WidgetDevice): string[] {
      const data = device.getData?.() ?? {};
      return [
        device.getId?.(),
        device.id,
        data.id,
        data.unitId,
      ].map((value) => String(value ?? '').trim()).filter(Boolean);
    }

    private getWidgetDeviceIdentity(device: WidgetDevice) {
      const data = device.getData?.() ?? {};
      const unitId = String(data.unitId ?? data.id ?? '').trim();
      if (!unitId) return undefined;
      return {
        id: this.getWidgetDeviceCandidateIds(device)[0] ?? unitId,
        unitId,
        name: device.getName?.() ?? 'Flexit ventilation',
        driverId: this.getWidgetDeviceDriverId(device, data),
        available: device.getAvailable?.() ?? true,
      };
    }

    private getWidgetDeviceDriverId(
      device: WidgetDevice,
      data: ReturnType<NonNullable<WidgetDevice['getData']>>,
    ) {
      return String(device.driver?.id ?? data.driverId ?? '').trim() || undefined;
    }

    private getWidgetDeviceOptions() {
      const options = [];
      for (const device of this.getWidgetDevices()) {
        const identity = this.getWidgetDeviceIdentity(device);
        if (identity) options.push(identity);
      }
      return options;
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

    private registerVentilationStoppedStateFlowTrigger() {
      const ventilationStoppedCard = this.homey.flow.getDeviceTriggerCard('ventilation_stopped');
      const ventilationResumedCard = this.homey.flow.getDeviceTriggerCard('ventilation_resumed');
      registry.setVentilationStoppedStateChangedHandler((event: any) => {
        runWithLogContext({
          unitId: this.resolveUnitId(event.device),
          stopped: event.stopped,
        }, () => {
          const card = event.stopped
            ? ventilationStoppedCard
            : ventilationResumedCard;
          card.trigger(
            event.device,
            {},
          ).catch((error: unknown) => {
            this.getLogger().error(
              'app.flow.trigger.ventilation_stopped_state.failed',
              'Failed to trigger ventilation stopped state flow',
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

    private registerHighDurationActionCard() {
      const setHighDurationCard = this.homey.flow.getActionCard('set_high_duration');
      setHighDurationCard.registerRunListener(async (args: any) => {
        const requestedMinutes = normalizeHighDurationMinutes(args?.minutes);
        const unitId = this.resolveUnitId(args?.device);
        await registry.setRapidVentilationDuration(unitId, requestedMinutes);
        return true;
      });
    }

    private registerTemporaryHighActionCard() {
      const activateTemporaryHighCard = this.homey.flow.getActionCard('activate_temporary_high');
      activateTemporaryHighCard.registerRunListener(async (args: any) => {
        const unitId = this.resolveUnitId(args?.device);
        await registry.activateTemporaryHigh(unitId);
        return true;
      });
    }

    private registerStopVentilationActionCard() {
      const stopVentilationCard = this.homey.flow.getActionCard('stop_ventilation');
      stopVentilationCard.registerRunListener(async (args: any) => {
        const unitId = this.resolveUnitId(args?.device);
        await registry.stopVentilation(unitId);
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

    private registerVentilationStoppedConditionCard() {
      const ventilationIsStoppedCard = this.homey.flow.getConditionCard('ventilation_is_stopped');
      ventilationIsStoppedCard.registerRunListener(async (args: any) => {
        const unitId = this.resolveUnitId(args?.device);
        return registry.getVentilationStopped(unitId);
      });
    }
  };
}
