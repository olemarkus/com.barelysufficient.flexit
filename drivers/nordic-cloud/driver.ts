import { FlexitCloudDriver } from '../../lib/FlexitCloudDriver';

export = class FlexitNordicCloudDriver extends FlexitCloudDriver {
  protected readonly series = 'nordic' as const;
};
