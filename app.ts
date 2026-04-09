import sourceMapSupport from 'source-map-support';

import Homey from 'homey';
import { createFlexitAppClass } from './lib/createAppClass';
import {
  Registry,
  isFanProfileMode,
  normalizeFanProfilePercent,
  normalizeFireplaceDurationMinutes,
} from './lib/UnitRegistry';

// NOTE: Homey expects CommonJS export for App/Driver/Device classes.
// Avoid `export default` for runtime compatibility.
export = createFlexitAppClass({
  HomeyApp: Homey.App,
  registry: Registry,
  isFanProfileMode,
  normalizeFanProfilePercent,
  normalizeFireplaceDurationMinutes,
  installSourceMapSupport: () => sourceMapSupport.install(),
});
