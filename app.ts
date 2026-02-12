import sourceMapSupport from 'source-map-support';

import Homey from 'homey';
import { Registry } from './lib/UnitRegistry';

sourceMapSupport.install();

// NOTE: Homey expects CommonJS export for App/Driver/Device classes.
// Avoid `export default` for runtime compatibility.
export = class App extends Homey.App {
  async onInit() {
    this.log('Flexit Nordic app init');
    Registry.setLogger({
      log: (...args: any[]) => this.log(...args),
      warn: (...args: any[]) => this.log(...args),
      error: (...args: any[]) => this.error(...args),
    });

    process.on('uncaughtException', (err) => {
      this.error('Uncaught Exception:', err);
    });

    process.on('unhandledRejection', (reason, _promise) => {
      this.error('Unhandled Rejection:', reason);
    });
  }
};
