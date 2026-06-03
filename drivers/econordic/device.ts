import { FlexitBacnetDevice } from '../../lib/FlexitBacnetDevice';

export = class FlexitEcoNordicDevice extends FlexitBacnetDevice {
  async onInit() {
    this.getLogger().info(
      'device.experimental',
      'EcoNordic support is experimental: the datapoint map is not yet validated against a real '
        + 'EcoNordic unit (it currently reuses the Nordic map), so readings and writes may be incorrect',
      { series: 'econordic', transport: 'bacnet' },
    );
    await super.onInit();
  }
};
