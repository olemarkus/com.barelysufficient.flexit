import Homey from 'homey';
import { Registry } from '../../lib/UnitRegistry';

export class FlexitThermostatDevice extends Homey.Device {
  async onInit() {
    this.log('Thermostat device init', this.getName());
    // Ensure class is thermostat
    await this.setClass('thermostat');

    const { unitId } = this.getData();
    try {
      Registry.register(unitId, this as any);
    } catch (e) {
      this.error('Failed to register with Registry:', e);
    }

    // Cleanup
    const capsToRemove = [
      'measure_humidity', 'fan_mode', 'measure_motor_rpm', 'measure_motor_rpm.extract',
      'measure_fan_speed_percent', 'measure_fan_speed_percent.extract', 'measure_hepa_filter',
    ];
    for (const cap of capsToRemove) {
      if (this.hasCapability(cap)) await this.removeCapability(cap).catch(this.error);
    }

    this.registerCapabilityListener('target_temperature', async (value: number) => {
      this.log(`Writing setpoint ${value} for unit ${unitId}`);
      await Registry.writeSetpoint(unitId, value);
    });
  }

  async onDeleted() {
    Registry.unregister(this.getData().unitId, this as any);
    this.log('Thermostat device deleted');
  }
}
