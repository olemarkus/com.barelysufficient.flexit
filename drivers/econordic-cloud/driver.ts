import { FlexitCloudDriver } from '../../lib/FlexitCloudDriver';

export = class FlexitEcoNordicCloudDriver extends FlexitCloudDriver {
  protected readonly series = 'econordic' as const;
};
