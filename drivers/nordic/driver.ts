import Homey from 'homey';
import { discoverFlexitUnits } from '../../lib/flexitDiscovery';

export = class FlexitNordicDriver extends Homey.Driver {
  async onInit() {
    this.log('Flexit Nordic driver init');
  }

  async onPairListDevices() {
    const units = await discoverFlexitUnits({
      timeoutMs: 5000,
      burstCount: 10,
      burstIntervalMs: 300,
    });

    return units.map((u) => ({
      name: u.name,
      data: {
        id: u.serialNormalized,
        unitId: u.serialNormalized,
      },
      settings: {
        ip: u.ip,
        bacnetPort: u.bacnetPort,
        serial: u.serial,
        mac: u.mac ?? '',
      },
    }));
  }
};
