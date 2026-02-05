import Homey from 'homey';
import { discoverFlexitUnits, listIPv4Interfaces } from '../../lib/flexitDiscovery';
import { FlexitThermostatDevice } from './device_thermostat';
import { FlexitFanDevice } from './device_fan';

type PairSession = any;

export = class FlexitNordicDriver extends Homey.Driver {
  async onInit() {
    this.log('Flexit Nordic driver init');
  }

  onMapDeviceClass(device: Homey.Device) {
    if (device.getData().role === 'fan') {
      return FlexitFanDevice;
    }
    return FlexitThermostatDevice;
  }

  async onPair(session: PairSession) {
    session.setHandler('get_interfaces', async () => {
      return listIPv4Interfaces();
    });

    session.setHandler('discover', async (data: { interfaceAddress?: string } = {}) => {
      const units = await discoverFlexitUnits({
        interfaceAddress: data.interfaceAddress,
        timeoutMs: 5000,
        burstCount: 10,
        burstIntervalMs: 300,
      });

      // Pass raw units to frontend, which will manipulate them into 2 devices
      return units.map((u) => ({
        name: u.name,
        serial: u.serial,
        ip: u.ip,
        bacnetPort: u.bacnetPort,
        mac: u.mac,
        // Helper object for frontend to clone:
        deviceTemplate: {
          data: { id: u.serialNormalized }, // Base ID
          settings: {
            ip: u.ip,
            bacnetPort: u.bacnetPort,
            serial: u.serial,
            mac: u.mac ?? '',
          },
        },
      }));
    });
  }
};
