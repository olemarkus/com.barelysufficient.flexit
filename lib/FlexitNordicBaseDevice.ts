import Homey from 'homey';
import {
  Registry,
  FlexitDevice,
  FILTER_CHANGE_INTERVAL_MONTHS_SETTING,
  FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING,
  FIREPLACE_DURATION_SETTING,
  FAN_PROFILE_MODES,
  FAN_PROFILE_SETTING_KEYS,
  FanProfileMode,
  MIN_FILTER_CHANGE_INTERVAL_HOURS,
  MAX_FILTER_CHANGE_INTERVAL_HOURS,
  MIN_FILTER_CHANGE_INTERVAL_MONTHS,
  MAX_FILTER_CHANGE_INTERVAL_MONTHS,
  normalizeFanProfilePercent,
  filterIntervalMonthsToHours,
  filterIntervalHoursToMonths,
  TARGET_TEMPERATURE_HOME_SETTING,
  TARGET_TEMPERATURE_AWAY_SETTING,
  MIN_TARGET_TEMPERATURE_C,
  MAX_TARGET_TEMPERATURE_C,
  normalizeFireplaceDurationMinutes,
  normalizeTargetTemperature,
} from './UnitRegistry';

const RESET_FILTER_CAPABILITY = 'button.reset_filter';
const REGISTRY_SETTING_SUPPRESSION_WINDOW_MS = 30_000;
const SETTING_SYNC_TOLERANCE = 0.1;
const REQUIRED_CAPABILITIES = [
  'measure_temperature.exhaust',
  'dehumidification_active',
  RESET_FILTER_CAPABILITY,
  'measure_fan_setpoint_percent',
  'measure_fan_setpoint_percent.extract',
] as const;

interface SuppressedSetting {
  value: unknown;
  expiresAt: number;
}

/**
 * Shared base class for Nordic Local and Nordic Cloud devices.
 * Contains all settings handling, capability registration, and suppression logic.
 * Subclasses implement onInit() with transport-specific registration.
 */
export abstract class FlexitNordicBaseDevice extends Homey.Device {
  private suppressedRegistrySettings = new Map<string, SuppressedSetting>();
  private settingsUpdateInProgress = false;
  private deferredRegistrySettings: Record<string, unknown> = {};
  private deferredFlushScheduled = false;

  protected async initSharedCapabilities() {
    await this.setClass('airtreatment');
    for (const capability of REQUIRED_CAPABILITIES) {
      if (this.hasCapability(capability)) continue;
      try {
        await this.addCapability(capability);
        this.log(`Added missing capability '${capability}'`);
      } catch (e) {
        this.error(`Failed adding capability '${capability}':`, e);
      }
    }
  }

  protected registerSharedCapabilityListeners(unitId: string) {
    this.registerCapabilityListener('target_temperature', async (value: number) => {
      await this.runCapabilityAction(
        'target_temperature',
        unitId,
        `writing setpoint ${value}`,
        async () => {
          this.log(`Writing setpoint ${value} for unit ${unitId}`);
          await Registry.writeSetpoint(unitId, value);
        },
      );
    });

    this.registerCapabilityListener('fan_mode', async (value) => {
      await this.runCapabilityAction(
        'fan_mode',
        unitId,
        `setting fan mode '${value}'`,
        async () => {
          this.log('Setting fan mode:', value);
          await Registry.setFanMode(unitId, value);
        },
      );
    });

    this.registerCapabilityListener(RESET_FILTER_CAPABILITY, async () => {
      await this.runCapabilityAction(
        RESET_FILTER_CAPABILITY,
        unitId,
        'resetting filter timer',
        async () => {
          this.log(`Resetting filter timer for unit ${unitId}`);
          await Registry.resetFilterTimer(unitId);
        },
      );
    });
  }

  /**
   * Hook for subclasses to wrap capability actions (e.g. BACnet timeout logging).
   * Default implementation simply runs the action directly.
   */
  protected async runCapabilityAction<T>(
    _capability: string,
    _unitId: string,
    _actionDescription: string,
    action: () => Promise<T>,
  ): Promise<T> {
    return action();
  }

  async onSettings({
    newSettings,
    changedKeys,
  }: {
    newSettings: Record<string, unknown>;
    changedKeys: string[];
  }): Promise<void> {
    this.settingsUpdateInProgress = true;
    try {
      const effectiveChangedKeys = this.filterSuppressedChangedKeys(changedKeys, newSettings);
      const monthsChanged = effectiveChangedKeys.includes(FILTER_CHANGE_INTERVAL_MONTHS_SETTING);
      const legacyHoursChanged = effectiveChangedKeys.includes(
        FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING,
      );
      const homeTargetTemperatureChanged = effectiveChangedKeys.includes(
        TARGET_TEMPERATURE_HOME_SETTING,
      );
      const awayTargetTemperatureChanged = effectiveChangedKeys.includes(
        TARGET_TEMPERATURE_AWAY_SETTING,
      );
      const fireplaceDurationChanged = effectiveChangedKeys.includes(FIREPLACE_DURATION_SETTING);
      const changedFanModes = this.getChangedFanModes(effectiveChangedKeys);
      if (
        !monthsChanged
        && !legacyHoursChanged
        && !homeTargetTemperatureChanged
        && !awayTargetTemperatureChanged
        && !fireplaceDurationChanged
        && changedFanModes.length === 0
      ) return;

      const { unitId } = this.getData();
      await this.maybeHandleFilterIntervalSetting(
        unitId, newSettings, monthsChanged, legacyHoursChanged,
      );
      await this.maybeHandleTargetTemperatureSetting(
        unitId, 'home', newSettings, homeTargetTemperatureChanged,
      );
      await this.maybeHandleTargetTemperatureSetting(
        unitId, 'away', newSettings, awayTargetTemperatureChanged,
      );
      await this.maybeHandleFireplaceDurationSetting(
        unitId, newSettings, fireplaceDurationChanged,
      );
      for (const mode of changedFanModes) {
        await this.maybeHandleFanProfileModeSetting(unitId, mode, newSettings);
      }
    } finally {
      this.settingsUpdateInProgress = false;
      this.scheduleDeferredRegistrySettingsFlush();
    }
  }

  private async maybeHandleTargetTemperatureSetting(
    unitId: string,
    mode: 'home' | 'away',
    newSettings: Record<string, unknown>,
    changed: boolean,
  ) {
    if (!changed) return;

    const settingKey = mode === 'home'
      ? TARGET_TEMPERATURE_HOME_SETTING
      : TARGET_TEMPERATURE_AWAY_SETTING;
    const requestedValue = Number(newSettings[settingKey]);
    if (!Number.isFinite(requestedValue)) {
      throw new Error(`${mode} target temperature must be numeric.`);
    }
    if (requestedValue < MIN_TARGET_TEMPERATURE_C || requestedValue > MAX_TARGET_TEMPERATURE_C) {
      throw new Error(
        `${mode} target temperature must be between ${MIN_TARGET_TEMPERATURE_C}`
        + ` and ${MAX_TARGET_TEMPERATURE_C} degC.`,
      );
    }
    const normalizedRequestedValue = normalizeTargetTemperature(requestedValue);

    const currentValue = Number(this.getSetting(settingKey));
    if (
      Number.isFinite(currentValue)
      && Math.abs(currentValue - normalizedRequestedValue) < SETTING_SYNC_TOLERANCE
    ) return;

    try {
      this.log(
        `Updating ${mode} target temperature to ${normalizedRequestedValue}C for unit ${unitId}`,
      );
      await Registry.setTemperatureSetpoint(unitId, mode, normalizedRequestedValue);
    } catch (error) {
      this.error(`Failed to update ${mode} target temperature:`, error);
      throw new Error(`Failed to update ${mode} target temperature on the unit.`);
    }
  }

  private getChangedFanModes(changedKeys: string[]): FanProfileMode[] {
    const changedFanModes: FanProfileMode[] = [];
    for (const mode of FAN_PROFILE_MODES) {
      const modeSettings = FAN_PROFILE_SETTING_KEYS[mode];
      if (
        !changedKeys.includes(modeSettings.supply)
        && !changedKeys.includes(modeSettings.exhaust)
      ) continue;
      changedFanModes.push(mode);
    }
    return changedFanModes;
  }

  private async maybeHandleFilterIntervalSetting(
    unitId: string,
    newSettings: Record<string, unknown>,
    monthsChanged: boolean,
    legacyHoursChanged: boolean,
  ) {
    if (!monthsChanged && !legacyHoursChanged) return;

    let requestedHours: number;
    if (monthsChanged) {
      const requestedMonths = Number(newSettings[FILTER_CHANGE_INTERVAL_MONTHS_SETTING]);
      if (
        !Number.isFinite(requestedMonths)
        || requestedMonths < MIN_FILTER_CHANGE_INTERVAL_MONTHS
        || requestedMonths > MAX_FILTER_CHANGE_INTERVAL_MONTHS
      ) {
        throw new Error(
          `Filter change interval must be between ${MIN_FILTER_CHANGE_INTERVAL_MONTHS}`
          + ` and ${MAX_FILTER_CHANGE_INTERVAL_MONTHS} months.`,
        );
      }
      requestedHours = filterIntervalMonthsToHours(requestedMonths);
    } else {
      requestedHours = Number(newSettings[FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING]);
      if (
        !Number.isFinite(requestedHours)
        || requestedHours < MIN_FILTER_CHANGE_INTERVAL_HOURS
        || requestedHours > MAX_FILTER_CHANGE_INTERVAL_HOURS
      ) {
        throw new Error(
          `Filter change interval must be between ${MIN_FILTER_CHANGE_INTERVAL_HOURS}`
          + ` and ${MAX_FILTER_CHANGE_INTERVAL_HOURS} hours.`,
        );
      }
    }

    const currentMonths = Number(this.getSetting(FILTER_CHANGE_INTERVAL_MONTHS_SETTING));
    const currentHours = Number(this.getSetting(FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING));
    const requestedMonths = filterIntervalHoursToMonths(requestedHours);
    const monthsInSync = Number.isFinite(currentMonths)
      && Math.abs(currentMonths - requestedMonths) < 0.5;
    const hoursInSync = Number.isFinite(currentHours)
      && Math.abs(currentHours - requestedHours) < 0.5;
    if (monthsInSync && hoursInSync) return;

    try {
      this.log(`Updating filter change interval to ${requestedHours}h for unit ${unitId}`);
      await Registry.setFilterChangeInterval(unitId, requestedHours);
    } catch (error) {
      this.error('Failed to update filter change interval:', error);
      throw new Error('Failed to update filter change interval on the unit.');
    }
  }

  private async maybeHandleFanProfileModeSetting(
    unitId: string,
    mode: FanProfileMode,
    newSettings: Record<string, unknown>,
  ) {
    const modeSettings = FAN_PROFILE_SETTING_KEYS[mode];
    const requestedSupply = Number(
      newSettings[modeSettings.supply] ?? this.getSetting(modeSettings.supply),
    );
    const requestedExhaust = Number(
      newSettings[modeSettings.exhaust] ?? this.getSetting(modeSettings.exhaust),
    );
    if (!Number.isFinite(requestedSupply) || !Number.isFinite(requestedExhaust)) {
      throw new Error(`Both supply and exhaust values are required for ${mode} fan settings.`);
    }
    const normalizedSupply = normalizeFanProfilePercent(requestedSupply, mode, 'supply');
    const normalizedExhaust = normalizeFanProfilePercent(requestedExhaust, mode, 'exhaust');

    const currentSupply = Number(this.getSetting(modeSettings.supply));
    const currentExhaust = Number(this.getSetting(modeSettings.exhaust));
    const supplyInSync = Number.isFinite(currentSupply)
      && Math.abs(currentSupply - normalizedSupply) < 0.5;
    const exhaustInSync = Number.isFinite(currentExhaust)
      && Math.abs(currentExhaust - normalizedExhaust) < 0.5;
    if (supplyInSync && exhaustInSync) return;

    try {
      this.log(
        `Updating ${mode} fan profile to supply=${normalizedSupply}%`
        + ` exhaust=${normalizedExhaust}% for unit ${unitId}`,
      );
      await Registry.setFanProfileMode(unitId, mode, normalizedSupply, normalizedExhaust);
    } catch (error) {
      this.error(`Failed to update ${mode} fan profile:`, error);
      throw new Error(`Failed to update ${mode} fan profile on the unit.`);
    }
  }

  private async maybeHandleFireplaceDurationSetting(
    unitId: string,
    newSettings: Record<string, unknown>,
    changed: boolean,
  ) {
    if (!changed) return;

    const normalizedDurationMinutes = normalizeFireplaceDurationMinutes(
      newSettings[FIREPLACE_DURATION_SETTING],
    );

    const currentDurationMinutes = Number(this.getSetting(FIREPLACE_DURATION_SETTING));
    if (
      Number.isFinite(currentDurationMinutes)
      && Math.abs(currentDurationMinutes - normalizedDurationMinutes) < SETTING_SYNC_TOLERANCE
    ) return;

    try {
      this.log(
        `Updating fireplace duration to ${normalizedDurationMinutes} minutes for unit ${unitId}`,
      );
      await Registry.setFireplaceVentilationDuration(unitId, normalizedDurationMinutes);
    } catch (error) {
      this.error('Failed to update fireplace duration:', error);
      throw new Error('Failed to update fireplace duration on the unit.');
    }
  }

  async applyRegistrySettings(settings: Record<string, unknown>): Promise<void> {
    if (this.settingsUpdateInProgress) {
      for (const [key, value] of Object.entries(settings)) {
        this.deferredRegistrySettings[key] = value;
      }
      return;
    }

    const expiresAt = Date.now() + REGISTRY_SETTING_SUPPRESSION_WINDOW_MS;
    for (const [key, value] of Object.entries(settings)) {
      this.suppressedRegistrySettings.set(key, { value, expiresAt });
    }
    await this.setSettings(settings);
  }

  private async flushDeferredRegistrySettings() {
    if (this.settingsUpdateInProgress) return;

    const deferredEntries = Object.entries(this.deferredRegistrySettings);
    if (deferredEntries.length === 0) return;

    this.deferredRegistrySettings = {};
    const deferredSettings = Object.fromEntries(deferredEntries);
    try {
      await this.applyRegistrySettings(deferredSettings);
    } catch (error) {
      this.deferredRegistrySettings = {
        ...deferredSettings,
        ...this.deferredRegistrySettings,
      };
      this.error('Failed to apply deferred registry settings:', error, deferredSettings);
    }
  }

  private scheduleDeferredRegistrySettingsFlush() {
    if (this.deferredFlushScheduled) return;
    this.deferredFlushScheduled = true;
    setTimeout(() => {
      this.deferredFlushScheduled = false;
      this.flushDeferredRegistrySettings().catch((error) => {
        this.error('Unexpected deferred registry settings flush failure:', error);
      });
    }, 0);
  }

  private filterSuppressedChangedKeys(
    changedKeys: string[],
    newSettings: Record<string, unknown>,
  ): string[] {
    const remaining: string[] = [];
    for (const key of changedKeys) {
      if (!this.isSuppressedRegistrySettingChange(key, newSettings[key])) {
        remaining.push(key);
      }
    }
    return remaining;
  }

  private isSuppressedRegistrySettingChange(key: string, nextValue: unknown): boolean {
    const entry = this.suppressedRegistrySettings.get(key);
    if (!entry) return false;

    if (entry.expiresAt < Date.now()) {
      this.suppressedRegistrySettings.delete(key);
      return false;
    }

    if (!this.settingsValuesMatch(entry.value, nextValue)) {
      return false;
    }

    this.suppressedRegistrySettings.delete(key);
    return true;
  }

  private settingsValuesMatch(expected: unknown, actual: unknown): boolean {
    const expectedNumber = Number(expected);
    const actualNumber = Number(actual);
    if (Number.isFinite(expectedNumber) && Number.isFinite(actualNumber)) {
      return Math.abs(expectedNumber - actualNumber) < SETTING_SYNC_TOLERANCE;
    }
    return expected === actual;
  }

  async onDeleted() {
    Registry.unregister(this.getData().unitId, this as unknown as FlexitDevice);
    this.log('Device deleted');
  }
}
