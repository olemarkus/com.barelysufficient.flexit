import Homey from 'homey';
import {
  Registry,
  FlexitDevice,
  FILTER_CHANGE_INTERVAL_MONTHS_SETTING,
  FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING,
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
  normalizeTargetTemperature,
} from '../../lib/UnitRegistry';

const EXHAUST_TEMP_CAPABILITY = 'measure_temperature.exhaust';
const RESET_FILTER_CAPABILITY = 'button.reset_filter';
const SUPPLY_SETPOINT_CAPABILITY = 'measure_fan_setpoint_percent';
const EXTRACT_SETPOINT_CAPABILITY = 'measure_fan_setpoint_percent.extract';
const CONNECTION_LABEL_SETTING_KEYS = ['ip', 'bacnetPort', 'serial', 'mac'] as const;
const REGISTRY_SETTING_SUPPRESSION_WINDOW_MS = 30_000;
const SETTING_SYNC_TOLERANCE = 0.1;
const REQUIRED_CAPABILITIES = [
  EXHAUST_TEMP_CAPABILITY,
  RESET_FILTER_CAPABILITY,
  SUPPLY_SETPOINT_CAPABILITY,
  EXTRACT_SETPOINT_CAPABILITY,
] as const;

interface SuppressedSetting {
  value: unknown;
  expiresAt: number;
}

export = class FlexitNordicDevice extends Homey.Device {
  private suppressedRegistrySettings = new Map<string, SuppressedSetting>();

  async onInit() {
    this.log('Nordic device init', this.getName());
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
    await this.normalizeConnectionLabelSettings();

    const { unitId } = this.getData();
    try {
      Registry.register(unitId, this as unknown as FlexitDevice);
    } catch (e) {
      this.error('Failed to register with Registry:', e);
    }

    this.registerCapabilityListener('target_temperature', async (value: number) => {
      this.log(`Writing setpoint ${value} for unit ${unitId}`);
      await Registry.writeSetpoint(unitId, value);
    });

    this.registerCapabilityListener('fan_mode', async (value) => {
      this.log('Setting fan mode:', value);
      await Registry.setFanMode(unitId, value);
    });

    this.registerCapabilityListener(RESET_FILTER_CAPABILITY, async () => {
      this.log(`Resetting filter timer for unit ${unitId}`);
      await Registry.resetFilterTimer(unitId);
    });
  }

  private async normalizeConnectionLabelSettings() {
    const updates: Record<string, string> = {};
    for (const key of CONNECTION_LABEL_SETTING_KEYS) {
      const value = this.getSetting(key);
      if (typeof value === 'string') continue;
      if (value === null || value === undefined) continue;
      updates[key] = String(value);
    }
    if (Object.keys(updates).length === 0) return;

    try {
      await this.setSettings(updates);
      this.log('Normalized legacy connection settings:', updates);
    } catch (error) {
      this.error('Failed to normalize legacy connection settings:', error, updates);
    }
  }

  async onSettings({
    newSettings,
    changedKeys,
  }: {
    newSettings: Record<string, unknown>;
    changedKeys: string[];
  }): Promise<void> {
    const effectiveChangedKeys = this.filterSuppressedChangedKeys(changedKeys, newSettings);
    const monthsChanged = effectiveChangedKeys.includes(FILTER_CHANGE_INTERVAL_MONTHS_SETTING);
    const legacyHoursChanged = effectiveChangedKeys.includes(FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING);
    const homeTargetTemperatureChanged = effectiveChangedKeys.includes(TARGET_TEMPERATURE_HOME_SETTING);
    const awayTargetTemperatureChanged = effectiveChangedKeys.includes(TARGET_TEMPERATURE_AWAY_SETTING);
    const changedFanModes = this.getChangedFanModes(effectiveChangedKeys);
    if (
      !monthsChanged
      && !legacyHoursChanged
      && !homeTargetTemperatureChanged
      && !awayTargetTemperatureChanged
      && changedFanModes.length === 0
    ) return;

    const { unitId } = this.getData();
    await this.maybeHandleFilterIntervalSetting(unitId, newSettings, monthsChanged, legacyHoursChanged);
    await this.maybeHandleTargetTemperatureSetting(unitId, 'home', newSettings, homeTargetTemperatureChanged);
    await this.maybeHandleTargetTemperatureSetting(unitId, 'away', newSettings, awayTargetTemperatureChanged);
    for (const mode of changedFanModes) {
      await this.maybeHandleFanProfileModeSetting(unitId, mode, newSettings);
    }
  }

  private async maybeHandleTargetTemperatureSetting(
    unitId: string,
    mode: 'home' | 'away',
    newSettings: Record<string, unknown>,
    changed: boolean,
  ) {
    if (!changed) return;

    const settingKey = mode === 'home' ? TARGET_TEMPERATURE_HOME_SETTING : TARGET_TEMPERATURE_AWAY_SETTING;
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
      this.log(`Updating ${mode} target temperature to ${normalizedRequestedValue}C for unit ${unitId}`);
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
      if (!changedKeys.includes(modeSettings.supply) && !changedKeys.includes(modeSettings.exhaust)) continue;
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
    const monthsInSync = Number.isFinite(currentMonths) && Math.abs(currentMonths - requestedMonths) < 0.5;
    const hoursInSync = Number.isFinite(currentHours) && Math.abs(currentHours - requestedHours) < 0.5;
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
    const requestedSupply = Number(newSettings[modeSettings.supply] ?? this.getSetting(modeSettings.supply));
    const requestedExhaust = Number(newSettings[modeSettings.exhaust] ?? this.getSetting(modeSettings.exhaust));
    if (!Number.isFinite(requestedSupply) || !Number.isFinite(requestedExhaust)) {
      throw new Error(`Both supply and exhaust values are required for ${mode} fan settings.`);
    }
    const normalizedSupply = normalizeFanProfilePercent(requestedSupply, mode, 'supply');
    const normalizedExhaust = normalizeFanProfilePercent(requestedExhaust, mode, 'exhaust');

    const currentSupply = Number(this.getSetting(modeSettings.supply));
    const currentExhaust = Number(this.getSetting(modeSettings.exhaust));
    const supplyInSync = Number.isFinite(currentSupply) && Math.abs(currentSupply - normalizedSupply) < 0.5;
    const exhaustInSync = Number.isFinite(currentExhaust) && Math.abs(currentExhaust - normalizedExhaust) < 0.5;
    if (supplyInSync && exhaustInSync) return;

    try {
      this.log(
        `Updating ${mode} fan profile to supply=${normalizedSupply}%`
        + ` exhaust=${normalizedExhaust}% for unit ${unitId}`,
      );
      await Registry.setFanProfileMode(
        unitId,
        mode,
        normalizedSupply,
        normalizedExhaust,
      );
    } catch (error) {
      this.error(`Failed to update ${mode} fan profile:`, error);
      throw new Error(`Failed to update ${mode} fan profile on the unit.`);
    }
  }

  async applyRegistrySettings(settings: Record<string, unknown>): Promise<void> {
    const expiresAt = Date.now() + REGISTRY_SETTING_SUPPRESSION_WINDOW_MS;
    for (const [key, value] of Object.entries(settings)) {
      this.suppressedRegistrySettings.set(key, { value, expiresAt });
    }
    await this.setSettings(settings);
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
    this.log('Nordic device deleted');
  }
}
