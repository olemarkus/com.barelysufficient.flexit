import Homey from 'homey';
import {
  Registry,
  FlexitDevice,
  FILTER_CHANGE_INTERVAL_MONTHS_SETTING,
  FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING,
  MIN_FILTER_CHANGE_INTERVAL_HOURS,
  MAX_FILTER_CHANGE_INTERVAL_HOURS,
  MIN_FILTER_CHANGE_INTERVAL_MONTHS,
  MAX_FILTER_CHANGE_INTERVAL_MONTHS,
  filterIntervalMonthsToHours,
  filterIntervalHoursToMonths,
} from '../../lib/UnitRegistry';

const EXHAUST_TEMP_CAPABILITY = 'measure_temperature.exhaust';
const RESET_FILTER_CAPABILITY = 'button.reset_filter';
const REQUIRED_CAPABILITIES = [EXHAUST_TEMP_CAPABILITY, RESET_FILTER_CAPABILITY] as const;

export = class FlexitNordicDevice extends Homey.Device {
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

  async onSettings({
    newSettings,
    changedKeys,
  }: {
    newSettings: Record<string, unknown>;
    changedKeys: string[];
  }): Promise<void> {
    const monthsChanged = changedKeys.includes(FILTER_CHANGE_INTERVAL_MONTHS_SETTING);
    const legacyHoursChanged = changedKeys.includes(FILTER_CHANGE_INTERVAL_HOURS_LEGACY_SETTING);
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

    const { unitId } = this.getData();
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

  async onDeleted() {
    Registry.unregister(this.getData().unitId, this as unknown as FlexitDevice);
    this.log('Nordic device deleted');
  }
}
