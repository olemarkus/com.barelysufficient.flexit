import Homey from 'homey';
import { Registry } from '../../lib/UnitRegistry';

export class FlexitFanDevice extends Homey.Device {
  async onInit() {
    this.log('Fan device init', this.getName());
    // Ensure class is fan
    await this.setClass('fan');

    const { unitId } = this.getData();
    try {
      Registry.register(unitId, this as any);
    } catch (e) {
      this.error('Failed to register with Registry:', e);
    }

    // Cleanup
    const capsToRemove = [
      'target_temperature', 'measure_temperature', 'measure_temperature.outdoor',
      'measure_temperature.extract', 'measure_power',
    ];
    for (const cap of capsToRemove) {
      if (this.hasCapability(cap)) await this.removeCapability(cap).catch(this.error);
    }

    // Fan Mode Listener
    this.registerCapabilityListener('fan_mode', async (value) => {
      this.log('Setting fan mode:', value);
      await Registry.setFanMode(unitId, value);
    });
  }

  async onDeleted() {
    Registry.unregister(this.getData().unitId, this as any);
    this.log('Fan device deleted');
  }
}
