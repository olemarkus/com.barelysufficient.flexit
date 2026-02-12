import Homey from 'homey';
import { Registry, FlexitDevice } from '../../lib/UnitRegistry';

const EXHAUST_TEMP_CAPABILITY = 'measure_temperature.exhaust';

export = class FlexitNordicDevice extends Homey.Device {
  async onInit() {
    this.log('Nordic device init', this.getName());
    await this.setClass('airtreatment');
    if (!this.hasCapability(EXHAUST_TEMP_CAPABILITY)) {
      try {
        await this.addCapability(EXHAUST_TEMP_CAPABILITY);
        this.log(`Added missing capability '${EXHAUST_TEMP_CAPABILITY}'`);
      } catch (e) {
        this.error(`Failed adding capability '${EXHAUST_TEMP_CAPABILITY}':`, e);
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
  }

  async onDeleted() {
    Registry.unregister(this.getData().unitId, this as unknown as FlexitDevice);
    this.log('Nordic device deleted');
  }
}
