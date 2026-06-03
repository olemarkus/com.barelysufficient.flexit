import { FlexitBacnetDriver } from '../../lib/FlexitBacnetDriver';

export = class FlexitEcoNordicDriver extends FlexitBacnetDriver {
  protected readonly series = 'econordic' as const;
};
