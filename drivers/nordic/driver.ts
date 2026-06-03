import { FlexitBacnetDriver } from '../../lib/FlexitBacnetDriver';

export = class FlexitNordicDriver extends FlexitBacnetDriver {
  protected readonly series = 'nordic' as const;
};
