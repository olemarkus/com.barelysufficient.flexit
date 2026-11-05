import sourceMapSupport from 'source-map-support';

import HomeySDK from 'homey';
import { createFlexitAppClass } from './lib/createAppClass';
import {
  Registry,
  isFanProfileMode,
  normalizeFanProfilePercent,
  normalizeFireplaceDurationMinutes,
  normalizeHighDurationMinutes,
} from './lib/UnitRegistry';

// NOTE: Homey expects CommonJS export for App/Driver/Device classes.
// Avoid `export default` for runtime compatibility.
export = createFlexitAppClass({
  HomeyApp: HomeySDK.App,
  registry: Registry,
  isFanProfileMode,
  normalizeFanProfilePercent,
  normalizeFireplaceDurationMinutes,
  normalizeHighDurationMinutes,
  installSourceMapSupport: () => sourceMapSupport.install(),
});
